---
name: close-dependabot
description: 'Bulk-close open Dependabot pull requests across every Auro repository. Resolves the Auro repo set from the AlaskaAirlines `auro-team` GitHub team (non-archived repos), finds every open PR authored by Dependabot in those repos, and shows a numbered summary table (repo, PR link, title, opened date) plus per-repo counts. It then asks which to exclude — by list number or range, by repo name, or by a quoted phrase matched against PR titles (e.g. a package name) — and closes only the approved PRs, retrying transient failures once and reporting what was closed, skipped, or failed. It only closes PRs; it never merges, comments, deletes branches, or edits Dependabot config.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/close-dependabot/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`) — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **close-dependabot** skill. The invocation itself is the request: **begin the workflow immediately** and walk through the steps below **in order**. Do not skip a step and do not reorder them. Step 4 prompts the user — ask, wait for the reply, and resolve it before continuing.

> **Scope guardrail — close approved Dependabot PRs, nothing more.** This skill's **only** mutating side effect is `gh pr close` on the PRs the user approved in Step 4/5. It must **NOT**, under any circumstance:
> - close a PR that isn't authored by Dependabot, isn't in an Auro repo, or wasn't on the approved list;
> - merge, approve, comment on, label, reopen, or edit any PR;
> - delete branches (no `--delete-branch` — Dependabot cleans up its own branches), or push, commit, or touch any local repo;
> - edit `dependabot.yml`, repo settings, or Dependabot alerts.
>
> If any step seems to call for one of these actions, stop and hand control back to the user instead.

**Org:** `AlaskaAirlines`. **Auro repos** = the non-archived repos of the `auro-team` GitHub team. That team covers the Auro repos whose names don't contain "auro" (`Icons`, `WC-Generator`, `WebCoreStyleSheets`, `eslint-config`) and leaves out unrelated org repos that also get Dependabot PRs (terraform modules, interview exercises, …).

**What closing does to Dependabot:** closing a version-update PR tells Dependabot to skip **that version**. It opens a new PR when a newer version comes out. Closing a grouped PR skips that group update. Mention this in the final report (Step 7).

---

## Step 0 — Preconditions

Run `gh auth status`. If it reports not-logged-in (non-zero exit), **stop** and tell the user: "GitHub CLI isn't authenticated — run `gh auth login`, then re-run `/auro:close-dependabot`."

---

## Step 1 — Resolve the Auro repo set

```bash
gh api --paginate 'orgs/AlaskaAirlines/teams/auro-team/repos?per_page=100' \
  --jq '.[] | select(.archived | not) | .name' > /tmp/dependabot_auro_repos.txt
wc -l < /tmp/dependabot_auro_repos.txt
```

If the call fails or the file is empty (e.g. the token can't read org teams), fall back to repos whose name contains `auro` and **warn the user** that this misses `Icons`, `WC-Generator`, `WebCoreStyleSheets`, and `eslint-config`:

```bash
gh search repos --owner AlaskaAirlines auro --archived=false --limit 1000 --json name \
  --jq '.[] | select(.name | test("auro"; "i")) | .name' > /tmp/dependabot_auro_repos.txt
```

---

## Step 2 — Find open Dependabot PRs in those repos

Search the whole org once, then keep only the Auro repos. Each kept PR gets a stable list number (`idx`), sorted by repo name then PR number:

```bash
gh search prs --owner AlaskaAirlines --author app/dependabot --state open --limit 1000 \
  --json repository,number,title,url,createdAt > /tmp/dependabot_all.json
jq length /tmp/dependabot_all.json

jq --rawfile repos /tmp/dependabot_auro_repos.txt '
  ($repos | split("\n") | map(select(length > 0))) as $r
  | [ .[] | select(.repository.name as $n | $r | index($n)) ]
  | sort_by((.repository.name | ascii_downcase), .number)
  | to_entries | map(.value + {idx: (.key + 1)})' /tmp/dependabot_all.json > /tmp/dependabot_close_list.json
jq length /tmp/dependabot_close_list.json
```

- If the org-wide count is exactly **1000**, the search hit GitHub's result cap. Warn the user that some PRs may be missing and that re-running after this pass will pick up the rest.
- If the filtered list is **empty**, tell the user there are no open Dependabot PRs in the Auro repos and **stop**.

---

## Step 3 — Show the summary

Render the table and the per-repo counts:

```bash
jq -r '"| # | Repo | PR | Title | Opened |", "|---|---|---|---|---|",
  (.[] | "| \(.idx) | \(.repository.name) | [#\(.number)](\(.url)) | \(.title | gsub("\\|"; "\\|")) | \(.createdAt[:10]) |")' \
  /tmp/dependabot_close_list.json
jq -r 'group_by(.repository.name) | map("\(.[0].repository.name) (\(length))") | join(" · ")' \
  /tmp/dependabot_close_list.json
```

Bash output isn't reliably shown to the user, so **reproduce the full table in your reply**, with every row and nothing summarized away. Put a one-line header above it: **"Found N open Dependabot PRs across M Auro repos:"**, and put the per-repo counts line below it.

---

## Step 4 — Ask for exclusions

Ask in plain text (not `AskUserQuestion` — the answer is free-form):

> **Which of these should I leave open?** Reply with any mix of:
> - list numbers or ranges from the `#` column — e.g. `3, 7, 12-15`
> - repo names, to keep all of that repo's PRs open — e.g. `auro-header`
> - a phrase in quotes, to keep every PR whose title contains it — e.g. `"auro-cli"`
>
> Or reply `none` to close all N, or `cancel` to stop without closing anything.

Wait for the reply.

- `cancel` → stop. Tell the user nothing was closed.
- `none` → nothing is excluded. Write `{"idx":[],"repos":[],"title":[]}` to `/tmp/dependabot_exclude.json` and go to Step 5. Skip the confirmation there, because replying `none` already approves closing the whole list.
- Anything else → parse it into `/tmp/dependabot_exclude.json` (use the Write tool) as `{"idx":[…], "repos":[…], "title":[…]}`. Expand ranges into individual numbers. Bare words that match a repo name go in `repos`. Quoted phrases go in `title`. If part of the reply can't be classified, ask about that part instead of guessing.

Validate the exclusions against the list:

```bash
jq -n -c --slurpfile ex /tmp/dependabot_exclude.json --slurpfile list /tmp/dependabot_close_list.json '
  $ex[0] as $e | $list[0] as $l
  | { unknownIdx: [ $e.idx[] | select(. < 1 or . > ($l | length)) ],
      unknownRepos: [ $e.repos[] | select(ascii_downcase as $r | [ $l[].repository.name | ascii_downcase ] | index($r) | not) ],
      unmatchedPhrases: [ $e.title[] | select(ascii_downcase as $p | [ $l[].title | ascii_downcase | select(contains($p)) ] | length == 0) ] }'
```

If any array is non-empty, show the user which numbers, repos, or phrases didn't match and ask them to correct it. Don't silently drop them, because a typo would otherwise close a PR they meant to keep.

---

## Step 5 — Build the approved list and confirm

```bash
jq --slurpfile ex /tmp/dependabot_exclude.json '
  $ex[0] as $e
  | ($e.repos | map(ascii_downcase)) as $repos
  | ($e.title | map(ascii_downcase)) as $phrases
  | map(. + { excluded: (
        (.idx as $i | $e.idx | index($i)) != null
        or ((.repository.name | ascii_downcase) as $n | $repos | index($n)) != null
        or ((.title | ascii_downcase) as $t | any($phrases[]; . as $p | $t | contains($p)))
      ) })' /tmp/dependabot_close_list.json > /tmp/dependabot_marked.json
jq '[ .[] | select(.excluded | not) ]' /tmp/dependabot_marked.json > /tmp/dependabot_to_close.json
jq -r '.[] | select(.excluded) | "| \(.idx) | \(.repository.name) | [#\(.number)](\(.url)) | \(.title) |"' /tmp/dependabot_marked.json
jq 'length' /tmp/dependabot_to_close.json
```

If the user replied `none`, go straight to Step 6.

Otherwise, show the **excluded** PRs as a table, so the user can check that their reply matched the PRs they meant. Then show the count to close. Confirm with `AskUserQuestion`:
- **Close K PRs** → Step 6.
- **Change exclusions** → back to Step 4. Keep the same list numbers.
- **Cancel** → stop. Nothing is closed.

If K is 0 (everything was excluded), tell the user nothing will be closed and stop.

---

## Step 6 — Close the approved PRs

Close each PR, recording the result. After the first pass, wait a minute and retry any failures once, because bulk mutations can trip GitHub's secondary rate limit:

```bash
jq -r '.[] | "\(.repository.nameWithOwner) \(.number)"' /tmp/dependabot_to_close.json > /tmp/dependabot_queue.txt
: > /tmp/dependabot_failed.txt
while read -r repo num; do
  if out=$(gh pr close "$num" -R "$repo" 2>&1); then echo "OK   $repo#$num  $out"
  else echo "$repo $num" >> /tmp/dependabot_failed.txt; echo "FAIL $repo#$num  $out"; fi
done < /tmp/dependabot_queue.txt > /tmp/dependabot_results.txt
wc -l < /tmp/dependabot_failed.txt
```

If any failed:

```bash
sleep 60
mv /tmp/dependabot_failed.txt /tmp/dependabot_retry.txt; : > /tmp/dependabot_failed.txt
while read -r repo num; do
  if out=$(gh pr close "$num" -R "$repo" 2>&1); then echo "OK   $repo#$num  (retry) $out"
  else echo "$repo $num" >> /tmp/dependabot_failed.txt; echo "FAIL $repo#$num  (retry) $out"; fi
done < /tmp/dependabot_retry.txt >> /tmp/dependabot_results.txt
```

The close loop is long-running for large lists (a second or two per PR). Give the Bash call a generous timeout, e.g. 10 minutes. If the list is too big for one call, split the queue file into chunks and run them one at a time.

A PR that was merged or closed after Step 2 makes `gh` print a message saying it is already closed or merged. Depending on the case, `gh` may exit 0 or non-zero. Count any result line with that message as **skipped**, whether it starts with `OK` or `FAIL`.

---

## Step 7 — Report

```bash
cat /tmp/dependabot_results.txt
```

Summarize for the user:
- **Closed:** total, plus per-repo counts.
- **Skipped:** PRs that were already closed or merged, with links.
- **Failed:** each PR that still failed after the retry, with a link and the `gh` error. Common causes are missing write access to the repo or a rate limit; if it's a rate limit, suggest re-running the skill later.
- **Left open:** the count the user excluded.
- A one-line reminder that Dependabot will skip the versions it just closed and open new PRs for newer releases.
