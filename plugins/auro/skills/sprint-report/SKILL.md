---
name: sprint-report
description: Generate a sprint report from the Auro Design System Azure DevOps board. It prompts for which iteration (sprint) to report on, reports the date range that iteration covers, then runs a saved ADO query filtered to work items changed during that range (excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative work item types report-wide) and summarizes them as a Work Item Type × current State matrix (User Story/Bug/Design Story/… against New/New (edit only)/Approved/Active/Blocked/Resolved/…), with the New column split into items actually created during the sprint versus older items still in New (New (edit only)), and the Closed column split into items that have a linked GitHub pull request or commit versus those that don't. It also renders a matrix showing the +/- change in each count versus the previous sprint, the same current/diff matrices filtered to items carrying the Support tag, a breakdown of the current sprint by assignee, the same current/diff matrices grouped by Area Path, two flat lists of tickets finished this sprint (current state Closed/Done/Rejected) split by whether they have a linked GitHub commit or pull request, and a flat list of open work-in-progress — every ticket that held a state other than New or Approved at any point during the sprint (using each item's revision history, not just its current state) and is not currently Closed, Removed, Rejected, or Done. It also generates a per-bug root-cause **narrative** section (Section 8a) that, for every closed Bug that shipped code, flags whether it was a Support ticket (and who reported it), traces the fix's changed lines back through `git blame` to the prior GitHub pull request(s) that last touched them (link and date), names who reviewed that last touch (humans vs AI bots), lists the contributors who last touched the buggy lines, makes an evidence-grounded (fallback code-style) AI-vs-human guess about who wrote that code, gives a leadership-level explanation of the process gap that let the defect slip past that earlier review, records the regression remedies the fix already applied, and recommends follow-on prevention steps. After rendering, it offers to export the report to a Markdown file at a filename and directory you choose (defaulting the filename to the sprint name). Read-only against Azure DevOps — it never creates or edits work items.
disable-model-invocation: true
allowed-tools: Bash(curl *), Bash(jq *), Bash(seq *), Bash(sort *), Bash(uniq *), Bash(awk *), Bash(wc *), Bash(date *), Bash(tr *), Bash(cat *), Bash(printf *), Bash(test *), Bash(git *), Write
---

## Task — start now

Generate the sprint report by running the steps below **in order**. Step 1 prompts the user to pick an iteration — ask, wait for the reply, and resolve it before continuing. This skill is **read-only**: it only reads Azure DevOps (org `itsals`, project `E_Retain_Content`) and never creates, updates, or deletes work items.

**Saved query:** `dd6c905b-e590-4e65-8bd2-c5e8952af326` — a flat query on the Auro Design System board that includes closed work items. (View it at https://dev.azure.com/itsals/E_Retain_Content/_queries/query/dd6c905b-e590-4e65-8bd2-c5e8952af326/.)

**Azure DevOps access (PAT).** Every ADO REST call authenticates with a **Personal Access Token** in the `ADO_PAT` environment variable via HTTP Basic auth with an **empty username**: `curl -u ":$ADO_PAT"`.
- **Before the first ADO call,** verify the token is present: `` [ -n "$ADO_PAT" ] ``. If it's empty, stop and tell the user: *"No Azure DevOps token found. Create a PAT at https://itsals.visualstudio.com/_usersSettings/tokens with **Work Items (Read)** scope, then `export ADO_PAT=<token>` in your shell and re-run."*
- **The flat per-ticket tables' PR links** (the "done with linked code" and "open work-in-progress" tables) **also need the `GitHub Connections (Read)` scope** (`vso.githubconnections`, under "Show all scopes" when creating the PAT) so the skill can resolve which GitHub repo each linked pull request lives in. This scope is **optional**: without it the connections call returns non-200 and the `PR` column degrades gracefully to plain `PR #<n>` text (no link) rather than failing — so don't treat that non-200 as a fatal auth failure.
- **Detect auth failures, don't mistake them for empty results.** ADO answers an unauthenticated/insufficient request with its sign-in **HTML page** (HTTP 203, or a body starting with `<!DOCTYPE` / containing `Azure DevOps Services | Sign In`) or a 302/401. If any call returns a status other than `200`, or the body isn't the expected JSON, treat it as an **auth failure** — the PAT is missing, expired, or lacks scope — and show the same PAT guidance above. Never report it as an empty sprint or invent `az login` commands.
- **Never** print the PAT, echo `$ADO_PAT`, or write it to a file — always reference it as the `$ADO_PAT` variable in the command.

---

## Step 1 — Choose the iteration (sprint)

Fetch the project's iterations, present the active sprints, and ask the user which one to report on. Run this block (it writes two helper files: the numbered pick-list and the full set for name lookups):

```bash
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/sprint_iters.json -w "%{http_code}" \
  "$BASE/classificationnodes/Iterations?\$depth=10&api-version=7.0")
echo "iterations HTTP: $HTTP"   # must be 200 — anything else is an auth failure (see access rules)
TODAY=$(date -u +%Y-%m-%d)

# All dated iterations (name, dates, path) -> used to resolve a name the user types.
jq '[ [ .. | objects | select(.attributes?.startDate != null) ]
      | .[] | {name, start: .attributes.startDate[:10], finish: .attributes.finishDate[:10], path} ]' \
  /tmp/sprint_iters.json > /tmp/sprint_iter_all.json

# Presented pick-list: top-level sprints only (exclude the Archive / Content Migration folders),
# most recent first. Number N in the printed list maps to element N-1 here.
jq '[ .children[] | select(.attributes?.startDate != null)
      | {name, start: .attributes.startDate[:10], finish: .attributes.finishDate[:10]} ]
    | sort_by(.start) | reverse' \
  /tmp/sprint_iters.json > /tmp/sprint_iter_list.json

echo "=== Iterations (most recent first) ==="
jq -r --arg today "$TODAY" '
  (map(select(.start <= $today and $today <= .finish)) | .[0].start) as $curstart
  | ([ .[] | select($curstart != null and .start < $curstart) | .start ] | max) as $prevstart
  | to_entries[]
  | "\(.key+1)) \(.value.name)   [\(.value.start) → \(.value.finish)]"
    + (if (.value.start <= $today and $today <= .value.finish) then "   ← current"
       elif ($prevstart != null and .value.start == $prevstart) then "   ← previous"
       else "" end)
' /tmp/sprint_iter_list.json
```

Present that numbered list to the user and ask: **"Which iteration should I report on? Reply with a number from the list, a sprint name, `current` for the current sprint, or `previous` (`prev`) for the sprint just before it. Older sprints not shown (the Archive) can be selected by name."**

**Resolve their reply** to a single iteration and capture its `START` and `FINISH` (both `YYYY-MM-DD`):
- **A number `N`** → `jq -r '.[N-1] | "\(.name)\t\(.start)\t\(.finish)"' /tmp/sprint_iter_list.json` (substitute `N-1`).
- **`current`** → the list entry whose range contains today (the one marked `← current`). If today falls in no iteration, say so and ask them to pick from the list.
- **`previous` / `prev`** → the sprint immediately before the current one (the entry marked `← previous`): the top-level sprint whose start is the greatest one **strictly before** the today-containing sprint's start. This is relative to *today's* sprint, not to any selected sprint. Resolve it self-contained:
  ```bash
  TODAY=$(date +%F)
  jq -r --arg today "$TODAY" '
    (map(select(.start <= $today and $today <= .finish)) | .[0].start) as $c
    | if $c == null then "NO_CURRENT"
      else ( [ .[] | select(.start < $c) ] | sort_by(.start) | last ) as $p
        | (if $p == null then "NONE" else "\($p.name)\t\($p.start)\t\($p.finish)" end)
      end' /tmp/sprint_iter_list.json
  ```
  `NO_CURRENT` (today falls in no iteration) → say so and ask them to pick from the list. `NONE` (the current sprint is the earliest) → tell them there's no earlier sprint and ask them to pick. A `name`/`start`/`finish` row → use it as the selected iteration.
- **A name (or partial name)** → match case-insensitively against the full set, which includes archived sprints:
  ```bash
  SEL="<what the user typed>"
  jq -r --arg q "$SEL" '[ .[] | select(.name | ascii_downcase | contains($q | ascii_downcase)) ]
    | if length==0 then "NO_MATCH"
      elif length==1 then (.[0] | "\(.name)\t\(.start)\t\(.finish)")
      else "MULTI: " + ([ .[].name ] | join(" | ")) end' /tmp/sprint_iter_all.json
  ```
  `NO_MATCH` → tell them and re-ask. `MULTI:` → show the matches and ask them to narrow it. A single match → use it.

Set `ITER_NAME`, `START`, and `FINISH` from the resolved iteration before continuing. Never guess a range — it must come from the selected iteration's attributes.

**Iteration names contain spaces** (e.g. `Sprint 17.26 08.12-08.25`). The resolution snippets emit **tab-separated** `name` / `start` / `finish`, so never split that output on whitespace (a bare `read name start finish` would spill the name into the date fields). Read the two dates directly instead — e.g. `jq -r '.[N-1].start'` and `jq -r '.[N-1].finish'` — since `START`/`FINISH` are clean `YYYY-MM-DD` values you then paste literally into Step 3.

**Also resolve the previous sprint** (needed for the diff table in Step 3). The previous sprint is the top-level sprint whose start is the greatest one **strictly before** the selected `START` — take it from the same pick-list so archived/other-track iterations can't sneak in:

```bash
jq -r --arg s "$START" '[ .[] | select(.start < $s) ] | sort_by(.start) | last
  | if . == null then "NONE" else "\(.name)\t\(.start)\t\(.finish)" end' /tmp/sprint_iter_list.json
```

Capture `PITER_NAME`, `PSTART`, `PFINISH` (again, read the dates directly — `... | last.start` / `... | last.finish` — never whitespace-split). If the result is `NONE` (the selected sprint is the earliest in the list), there is no previous sprint: skip the diff table in Steps 3–4 and note that instead.

---

## Step 2 — Report the date range

Tell the user the range the chosen iteration covers, e.g. **"**`<ITER_NAME>`** covers `<START>` through `<FINISH>` — filtering to work items changed in that window."** This confirms the selection before the (slower) query runs.

---

## Step 3 — Run the query and build the report matrices (filtered to the iteration's range)

A flat WIQL query returns only work item **IDs**, so the report is built in stages: run the saved query for the IDs, batch-fetch each item's `System.WorkItemType`, `System.State`, `System.ChangedDate`, `System.AssignedTo`, `System.AreaPath`, `System.CreatedDate`, and `System.Tags` (the batch endpoint accepts at most 200 IDs per call, so the IDs are chunked), then — for the **Closed** items in **either** the current or previous sprint's range — a second batch pass fetches their **relations** to detect whether each has any linked GitHub **pull request or commit**. Because the saved query returns the whole board (not just one sprint), both sprints are computed from the same fetched rows: items whose **changed date falls within `[START, FINISH]` inclusive** (comparing the `YYYY-MM-DD` date portion, so the entire finish day counts) feed the current matrix, and items within `[PSTART, PFINISH]` feed the previous-sprint counts. Immediately after the fetch, a **report-wide type filter** removes the `Test Case`, `Test Plan`, `Test Suite`, `Epic`, `Feature`, and `Initiative` work item types from the shared rows file, so they appear in **none** of the ten tables (every pass reads the already-filtered file).

Four awk passes, two snapshot **done** passes, and one **revision-history** pass build **ten** tables. The first pass emits blocks marked `=== CURRENT ===` and `=== DIFF ===`:
- **CURRENT** — the **Work Item Type × State** matrix for the selected sprint (rows = type, columns = current State, with row/column/grand totals). The single `New` state is **split into two columns** — `New` for items whose `System.CreatedDate` falls **inside** the sprint's range (genuinely new this sprint) and `New (edit only)` for items still in New that were **created before** the sprint (older backlog items merely touched this sprint). The single `Closed` state is likewise **split into two columns** — `Closed (PR/commit)` for items with a linked GitHub PR or commit, and `Closed (no code)` for the rest. In the diff matrix the New/New (edit only) split is computed **per sprint** (an item counts as `New` for whichever sprint's range contains its created date), so the comparison stays like-for-like.
- **DIFF** — the same matrix shape but each cell is `current − previous` (formatted `+N` / `0` / `-N`), over the **union** of the types and states seen in either sprint (so a type/state that only appeared last sprint shows as a negative). If there is no previous sprint (Step 1 returned `NONE`), skip this block.

The second pass emits `=== SUPPORT CURRENT ===` and `=== SUPPORT DIFF ===` — **exactly** the CURRENT and DIFF matrices above, but restricted to items whose **current** `System.Tags` include the `Support` tag (matched as a whole tag, not a substring, so `Support` matches but `Supportive` would not). If no Support-tagged item changed in the selected range the pass prints `NO_SUPPORT_ITEMS`; if there is no previous sprint it emits `=== SUPPORT NO_PREVIOUS ===` instead of the diff block.

The third pass emits `=== BY ASSIGNEE ===`:
- **BY ASSIGNEE** — the current sprint's State matrix again, but keyed on **current assignee** (`System.AssignedTo`, unassigned items grouped as `Unassigned`) as the leading column, with **Work Item Type** as the second column. Rows are grouped by assignee and sorted by the first column (assignee) alphabetically, then the second (type) alphabetically, so each person's work item types form a block ending in a `Subtotal` row (that person's sprint total). The grand `Total` row matches the CURRENT table's `Total` row.

The fourth pass emits `=== AREA CURRENT ===` and `=== AREA DIFF ===` — the same two matrices as the first pass but with **rows keyed on Area Path** (`System.AreaPath`) instead of Work Item Type. The constant `E_Retain_Content\Auro Design System` prefix is trimmed from each path for readability (so a component sub-area reads as `auro-formkit\auro-input`), and items filed directly on that top-level node collapse to `(root)`. Rows are the distinct area paths as stored (not rolled up), sorted **alphabetically by area path**. Their `Total` rows equal the CURRENT and DIFF tables' `Total` rows (same items, grouped a different way). The `AREA DIFF` block is skipped when there is no previous sprint.

Finally, a **revision-history pass** builds the tenth (last) table, `=== OPEN WIP ===` — a flat list (not a matrix) of every ticket that was **worked during the sprint but is still open**. A ticket qualifies when **both** hold:
- **In-window (history):** at some moment inside `[START, FINISH]` its `System.State` was **anything other than `New` or `Approved`** (i.e. it was actually being worked). This is a question about the item's *history*, not its current snapshot — an item that was `Active` mid-sprint but has since been parked back to `New` still qualifies — so it can't be answered from the batch fetch alone.
- **Current (snapshot):** its **current** `System.State` is **not** `Closed`, `Removed`, `Rejected`, or `Done` (it "did not get closed yet"; `Done` is treated as effectively closed).

Because per-item revision history is a separate ADO call (`GET .../workitems/{id}/revisions`, **not** batchable), the pass first uses the snapshot to avoid calls it doesn't need. For each **open** item (current state not Closed/Removed/Rejected/Done) it decides from the snapshot alone where it can: **auto-include** when the current state is already a worked state (not New/Approved) and the last `ChangedDate` is on/before `FINISH` (so that worked state provably spans into the window), and **auto-exclude** when the current state is New/Approved and the last `ChangedDate` is strictly before `START` (so it sat in New/Approved untouched across the whole window). Only the remaining undecidable items — currently New/Approved but changed on/after `START`, or changed after `FINISH` — get a revision-history call, whose timeline is walked to test whether any state ∉ {New, Approved} was held during `[START, FINISH]` (day-granularity: revision *i* covers `[date_i, date_{i+1})`, and overlaps the window when `date_i <= FINISH` and `date_{i+1} >= START`). The qualifying set is the auto-included items plus the history-confirmed ones; each is then joined back to the snapshot for its type, current state, assignee, area path, and title. One more relations pass over just the qualifying set detects **linked GitHub pull requests** (an `ArtifactLink` named `GitHub Pull Request`, whose artifact URI carries the PR *number* but no repo name), rendered as a `PR` column placed immediately after the `ID`. The repo is resolved by fetching the project's **authoritative connected-repo list** (the GitHub Connections API) and matching each item's first area-path segment against it (case-insensitively), so each PR links to `<repo-url>/pull/<n>` with the exact repo casing; anything that doesn't match a connected repo — a bare-root item, an area whose component repo isn't connected, or (if the PAT lacks the `GitHub Connections (Read)` scope) every item — falls back to plain `PR #<n>` text rather than a guessed URL. Because Azure Boards links commits and PRs **independently** (each artifact must carry its own `AB#<id>` mention), some tickets have linked commits but no linked PR even though the commits belong to one. For those the same pass captures a few `GitHub Commit` SHAs and, as a **fallback**, asks GitHub's API which PR contains one of them (`/repos/<owner>/<repo>/commits/<sha>/pulls`, repo resolved the same way); a match renders as `[PR #<n>](<url>) (via commit)` so it's distinguishable from a directly-linked PR. ADO's own PR links always take precedence; the fallback only fills gaps, needs no extra ADO scope (it calls GitHub, honoring `$GITHUB_TOKEN` if set for a higher rate limit), and silently yields nothing on a private repo or rate-limit. If nothing qualifies the pass prints `NO_OPEN_WIP`.

Two more flat lists — the **eighth** and **ninth** tables — are printed **before** the open-WIP table and use the same PR machinery. They cover tickets **changed this sprint** whose **current** state is a done state (`Closed`, `Done`, or `Rejected`; `Resolved` is treated as still-in-progress and stays in open WIP, and `Removed` is dropped from both), split by whether the item carries any linked GitHub commit or pull request: `=== DONE WITH CODE ===` (has code — rendered with the full `PR` column, including the commit→PR fallback) and `=== DONE NO CODE ===` (no code — rendered **without** a PR column, since there is nothing to link). These use the current snapshot (no revision-history calls). Membership in the "with code" table is by presence of a linked commit **or** PR, so a row there can still have an empty `PR` cell when its only link is a commit that isn't in any resolvable PR. Empty sets print `NO_DONE_WITH_CODE` / `NO_DONE_NO_CODE`. Output order is: the two done tables, then open WIP last.

The blocks compute all totals and diffs themselves, so the report just renders them. Run it with `START`/`FINISH` and `PSTART`/`PFINISH` from Step 1 (leave the two `P…` empty if there is no previous sprint):

```bash
START="<START>"; FINISH="<FINISH>"     # from the chosen iteration
PSTART="<PSTART>"; PFINISH="<PFINISH>" # from the previous sprint (empty if NONE)
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"

# 1. Run the stored query (flat -> work item id references only).
HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/sprint_wiql.json -w "%{http_code}" \
  "$BASE/wiql/dd6c905b-e590-4e65-8bd2-c5e8952af326?api-version=7.0")
echo "query HTTP: $HTTP"   # must be 200

# 2. Batch-fetch id + type + state + changed date + assignee + area path + created date + tags + title in chunks
#    of 200 -> "id<TAB>changed<TAB>type<TAB>state<TAB>assignee<TAB>area<TAB>created<TAB>tags<TAB>title" (assignee
#    display name or "Unassigned"; tags is ADO's "; "-joined tag string, empty when the item has no tags; title
#    is the last field, with any embedded tabs/newlines squashed to spaces so the row stays 9 tab-columns).
: > /tmp/sprint_rows.tsv
IDS_JSON=$(jq -c '[.workItems[].id]' /tmp/sprint_wiql.json)
TOTAL=$(jq 'length' <<<"$IDS_JSON")
for S in $(seq 0 200 $((TOTAL-1))); do
  BODY=$(jq -c --argjson s "$S" '{ids: .[$s:$s+200], fields:["System.WorkItemType","System.State","System.ChangedDate","System.AssignedTo","System.AreaPath","System.CreatedDate","System.Tags","System.Title"]}' <<<"$IDS_JSON")
  curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" --data-binary "$BODY" \
    "$BASE/workitemsbatch?api-version=7.0" \
  | jq -r '.value[] | "\(.id)\t\(.fields["System.ChangedDate"][:10])\t\(.fields["System.WorkItemType"])\t\(.fields["System.State"])\t\(.fields["System.AssignedTo"].displayName // "Unassigned")\t\(.fields["System.AreaPath"])\t\(.fields["System.CreatedDate"][:10])\t\(.fields["System.Tags"] // "")\t\((.fields["System.Title"] // "") | gsub("[\t\n\r]"; " "))"' >> /tmp/sprint_rows.tsv
done
echo "fetched rows: $(wc -l </tmp/sprint_rows.tsv | tr -d ' ') of $TOTAL"

# 2b. Report-wide type filter: drop these work item types so they appear in NONE of the ten tables. Applied
#     once here on the shared rows file, so every downstream pass (matrices, assignee, area, open-wip) inherits it.
EXCLUDE_TYPES="Test Case|Test Plan|Test Suite|Epic|Feature|Initiative"
BEFORE=$(wc -l </tmp/sprint_rows.tsv | tr -d ' ')
awk -F'\t' -v ex="$EXCLUDE_TYPES" 'BEGIN{n=split(ex,a,"|"); for(i=1;i<=n;i++) drop[a[i]]=1} !($3 in drop)' \
  /tmp/sprint_rows.tsv > /tmp/sprint_rows_filtered.tsv && mv /tmp/sprint_rows_filtered.tsv /tmp/sprint_rows.tsv
echo "excluded types [$EXCLUDE_TYPES]: dropped $((BEFORE - $(wc -l </tmp/sprint_rows.tsv | tr -d ' '))) rows; $(wc -l </tmp/sprint_rows.tsv | tr -d ' ') remain"

# 3. For Closed items in EITHER sprint's range, fetch relations ($expand=relations) and record whether
#    each has a linked GitHub pull request or commit. A "has code" link is an ArtifactLink named
#    "GitHub Commit" or "GitHub Pull Request" — NOT "GitHub Issue". Output: "id<TAB>true|false".
#    (Covering both ranges lets the diff table split the previous sprint's Closed column too.)
awk -F'\t' -v lo="$START" -v hi="$FINISH" -v plo="$PSTART" -v phi="$PFINISH" \
  '$4=="Closed" && (($2>=lo&&$2<=hi)||(plo!="" && $2>=plo&&$2<=phi)) {print $1}' \
  /tmp/sprint_rows.tsv | sort -u > /tmp/sprint_closed_ids.txt
CIDS_JSON=$(jq -cn '[inputs | tonumber]' /tmp/sprint_closed_ids.txt)
CN=$(jq 'length' <<<"$CIDS_JSON")
: > /tmp/sprint_hascode.tsv
for S in $(seq 0 200 $((CN>0 ? CN-1 : 0))); do
  [ "$CN" -eq 0 ] && break
  CHUNK=$(jq -c --argjson s "$S" '.[$s:$s+200]' <<<"$CIDS_JSON")
  curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" \
    --data-binary "{\"ids\":$CHUNK,\"\$expand\":\"relations\"}" \
    "$BASE/workitemsbatch?api-version=7.0" \
  | jq -r '.value[] | "\(.id)\t\((.relations // []) | any(.rel=="ArtifactLink" and (.attributes.name=="GitHub Commit" or .attributes.name=="GitHub Pull Request")))"' >> /tmp/sprint_hascode.tsv
done
echo "in-range Closed: $CN   with PR/commit: $(awk -F'\t' '$2=="true"' /tmp/sprint_hascode.tsv | wc -l | tr -d ' ')"

# 4. Build the CURRENT matrix and the DIFF-vs-previous matrix (tab-separated), splitting New and Closed.
#    Two input files, discriminated by field count: 2-field = has-code map, 9-field = work-item rows
#    (id, changed, type, state, assignee, area, created, tags, title — this pass uses id/changed/type/state/created).
#    State columns follow ADO's workflow order; any state not listed is appended alphabetically.
#    Rows (types) are ordered by (combined) total, descending. Last column and last row are totals.
#    New splits into "New" (created inside the sprint) and "New (edit only)" (still New, created earlier);
#    the split is range-aware so each sprint counts its own newly-created items as New in the diff.
#    CURRENT uses only the selected sprint's types/states; DIFF uses the union of both sprints and
#    prints each cell as current-previous, formatted +N / 0 / -N. Empty PSTART => DIFF block omitted.
awk -F'\t' -v lo="$START" -v hi="$FINISH" -v plo="$PSTART" -v phi="$PFINISH" '
BEGIN{ npref=split("New,New (edit only),Design,Approved,Committed,Active,In Progress,Blocked,Ready For Acceptance,Resolved,Done,Closed (PR/commit),Closed (no code),Rejected,Removed",pref,",") }
NF==2 { code[$1]=$2; next }
NF>=7 {
  id=$1; d=$2; t=$3; s=$4; cr=$7
  cur=(d>=lo && d<=hi); prv=(plo!="" && d>=plo && d<=phi)
  if(!cur && !prv) next
  sc=s; sp=s
  if(s=="Closed"){ sc=(code[id]=="true")?"Closed (PR/commit)":"Closed (no code)"; sp=sc }
  else if(s=="New"){ sc=(cr>=lo&&cr<=hi)?"New":"New (edit only)"; sp=(plo!="" && cr>=plo&&cr<=phi)?"New":"New (edit only)" }
  if(cur){ c[t SUBSEP sc]++; crt[t]++; cct[sc]++; cg++; seenTc[t]=1; seenSc[sc]=1; seenSu[sc]=1 }
  if(prv){ p[t SUBSEP sp]++; prt[t]++; pct[sp]++; pg++; seenSu[sp]=1 }
  seenTu[t]=1
}
function ordcols(set,  i,s){                          # ordered columns from a state-set -> cols[]/ncol
  ncol=0; delete used
  for(i=1;i<=npref;i++){ if(pref[i] in set){ cols[++ncol]=pref[i]; used[pref[i]]=1 } }
  ne=0; delete extra
  for(s in set){ if(!(s in used)) extra[++ne]=s }
  for(i=1;i<=ne;i++) for(j=i+1;j<=ne;j++) if(extra[j]<extra[i]){x=extra[i];extra[i]=extra[j];extra[j]=x}
  for(i=1;i<=ne;i++) cols[++ncol]=extra[i]
}
function ordrows(set,w,  t){                           # ordered rows from a type-set by weight w[] -> rows[]/nr
  nr=0; delete rows
  for(t in set) rows[++nr]=t
  for(i=1;i<=nr;i++) for(j=i+1;j<=nr;j++) if(w[rows[j]]>w[rows[i]]){x=rows[i];rows[i]=rows[j];rows[j]=x}
}
function sgn(v){ return (v>0) ? "+"v : v"" }
END{
  if(cg==0){ print "NO_ITEMS_IN_RANGE"; exit }
  # ---- CURRENT (selected sprint columns/rows only) ----
  print "=== CURRENT ==="
  ordcols(seenSc); ordrows(seenTc, crt)
  h="Work Item Type"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++) L=L"\t"(c[t SUBSEP cols[cc]]+0); print L"\t"crt[t] }
  L="Total"; for(cc=1;cc<=ncol;cc++) L=L"\t"(cct[cols[cc]]+0); print L"\t"(cg+0)
  # ---- DIFF (union of both sprints); omitted when there is no previous sprint ----
  if(plo==""){ print "=== NO_PREVIOUS ==="; exit }
  print "=== DIFF ==="
  for(t in seenTu) uw[t]=crt[t]+prt[t]
  ordcols(seenSu); ordrows(seenTu, uw)
  h="Work Item Type"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++){ v=(c[t SUBSEP cols[cc]]+0)-(p[t SUBSEP cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(crt[t]-prt[t]) }
  L="Total"; for(cc=1;cc<=ncol;cc++){ v=(cct[cols[cc]]+0)-(pct[cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(cg-pg)
}' /tmp/sprint_hascode.tsv /tmp/sprint_rows.tsv

# 5. Build the SUPPORT CURRENT + SUPPORT DIFF matrices: identical to CURRENT/DIFF (step 4) but restricted to
#    rows whose current tag field ($8) contains the whole tag "Support". Tags are ADO's "; "-joined string,
#    so hastag() splits on ";", trims spaces, and compares exactly (so "Supportive" won't match "Support").
awk -F'\t' -v lo="$START" -v hi="$FINISH" -v plo="$PSTART" -v phi="$PFINISH" '
BEGIN{ npref=split("New,New (edit only),Design,Approved,Committed,Active,In Progress,Blocked,Ready For Acceptance,Resolved,Done,Closed (PR/commit),Closed (no code),Rejected,Removed",pref,",") }
function hastag(f,tag,  n,arr,i,x){ n=split(f,arr,";"); for(i=1;i<=n;i++){ x=arr[i]; gsub(/^ +| +$/,"",x); if(x==tag) return 1 } return 0 }
NF==2 { code[$1]=$2; next }
NF>=8 {
  if(!hastag($8,"Support")) next
  id=$1; d=$2; t=$3; s=$4; cr=$7
  cur=(d>=lo && d<=hi); prv=(plo!="" && d>=plo && d<=phi)
  if(!cur && !prv) next
  sc=s; sp=s
  if(s=="Closed"){ sc=(code[id]=="true")?"Closed (PR/commit)":"Closed (no code)"; sp=sc }
  else if(s=="New"){ sc=(cr>=lo&&cr<=hi)?"New":"New (edit only)"; sp=(plo!="" && cr>=plo&&cr<=phi)?"New":"New (edit only)" }
  if(cur){ c[t SUBSEP sc]++; crt[t]++; cct[sc]++; cg++; seenTc[t]=1; seenSc[sc]=1; seenSu[sc]=1 }
  if(prv){ p[t SUBSEP sp]++; prt[t]++; pct[sp]++; pg++; seenSu[sp]=1 }
  seenTu[t]=1
}
function ordcols(set,  i,s){ ncol=0; delete used
  for(i=1;i<=npref;i++){ if(pref[i] in set){ cols[++ncol]=pref[i]; used[pref[i]]=1 } }
  ne=0; delete extra
  for(s in set){ if(!(s in used)) extra[++ne]=s }
  for(i=1;i<=ne;i++) for(j=i+1;j<=ne;j++) if(extra[j]<extra[i]){x=extra[i];extra[i]=extra[j];extra[j]=x}
  for(i=1;i<=ne;i++) cols[++ncol]=extra[i] }
function ordrows(set,w,  t){ nr=0; delete rows
  for(t in set) rows[++nr]=t
  for(i=1;i<=nr;i++) for(j=i+1;j<=nr;j++) if(w[rows[j]]>w[rows[i]]){x=rows[i];rows[i]=rows[j];rows[j]=x} }
function sgn(v){ return (v>0) ? "+"v : v"" }
END{
  if(cg==0){ print "NO_SUPPORT_ITEMS"; exit }
  print "=== SUPPORT CURRENT ==="
  ordcols(seenSc); ordrows(seenTc, crt)
  h="Work Item Type"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++) L=L"\t"(c[t SUBSEP cols[cc]]+0); print L"\t"crt[t] }
  L="Total"; for(cc=1;cc<=ncol;cc++) L=L"\t"(cct[cols[cc]]+0); print L"\t"(cg+0)
  if(plo==""){ print "=== SUPPORT NO_PREVIOUS ==="; exit }
  print "=== SUPPORT DIFF ==="
  for(t in seenTu) uw[t]=crt[t]+prt[t]
  ordcols(seenSu); ordrows(seenTu, uw)
  h="Work Item Type"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++){ v=(c[t SUBSEP cols[cc]]+0)-(p[t SUBSEP cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(crt[t]-prt[t]) }
  L="Total"; for(cc=1;cc<=ncol;cc++){ v=(cct[cols[cc]]+0)-(pct[cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(cg-pg)
}' /tmp/sprint_hascode.tsv /tmp/sprint_rows.tsv

# 6. Build the BY ASSIGNEE table: the current sprint's Assignee x Type x State matrix, grouped by current
#    assignee (field $5) with a sub-row per work item type, plus a per-assignee Subtotal row and a grand Total.
#    Columns: Assigned To, then Work Item Type, then the same current-sprint state columns as CURRENT.
#    Rows are grouped/sorted by the first column (assignee) ascending, then the second (type) ascending.
echo "=== BY ASSIGNEE ==="
awk -F'\t' -v lo="$START" -v hi="$FINISH" '
BEGIN{ npref=split("New,New (edit only),Design,Approved,Committed,Active,In Progress,Blocked,Ready For Acceptance,Resolved,Done,Closed (PR/commit),Closed (no code),Rejected,Removed",pref,",") }
NF==2 { code[$1]=$2; next }
NF>=7 {
  id=$1; d=$2; t=$3; s=$4; a=$5; cr=$7
  if(!(d>=lo && d<=hi)) next
  if(s=="Closed") s=(code[id]=="true")?"Closed (PR/commit)":"Closed (no code)"
  else if(s=="New") s=(cr>=lo&&cr<=hi)?"New":"New (edit only)"
  cnt[a SUBSEP t SUBSEP s]++; rat[a SUBSEP t]++; asum[a SUBSEP s]++; ratot[a]++
  cct[s]++; g++; seenS[s]=1; seenA[a]=1; seenAT[a SUBSEP t]=1
}
END{
  if(g==0){ print "NO_ITEMS_IN_RANGE"; exit }
  ncol=0
  for(i=1;i<=npref;i++){ if(pref[i] in seenS){ cols[++ncol]=pref[i]; used[pref[i]]=1 } }
  for(s in seenS){ if(!(s in used)) extra[++ne]=s }
  for(i=1;i<=ne;i++) for(j=i+1;j<=ne;j++) if(extra[j]<extra[i]){x=extra[i];extra[i]=extra[j];extra[j]=x}
  for(i=1;i<=ne;i++) cols[++ncol]=extra[i]
  na=0; for(a in seenA) assignees[++na]=a                    # first column: assignees, ascending
  for(i=1;i<=na;i++) for(j=i+1;j<=na;j++) if(assignees[j]<assignees[i]){x=assignees[i];assignees[i]=assignees[j];assignees[j]=x}
  h="Assigned To\tWork Item Type"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(ai=1;ai<=na;ai++){
    a=assignees[ai]; nt=0
    for(k in seenAT){ split(k,kk,SUBSEP); if(kk[1]==a) tl[++nt]=kk[2] }
    for(i=1;i<=nt;i++) for(j=i+1;j<=nt;j++) if(tl[j]<tl[i]){x=tl[i];tl[i]=tl[j];tl[j]=x}   # second column: types, ascending
    # print the assignee name only on the first sub-row of the group (blank on the rest) so the
    # rendered table reads like a single "merged" Assigned To cell spanning the group.
    for(i=1;i<=nt;i++){ t=tl[i]; lab=(i==1)?a:""; L=lab"\t"t; for(cc=1;cc<=ncol;cc++) L=L"\t"(cnt[a SUBSEP t SUBSEP cols[cc]]+0); print L"\t"rat[a SUBSEP t] }
    L="\tSubtotal"; for(cc=1;cc<=ncol;cc++) L=L"\t"(asum[a SUBSEP cols[cc]]+0); print L"\t"ratot[a]
    delete tl
  }
  L="Total\t"; for(cc=1;cc<=ncol;cc++) L=L"\t"(cct[cols[cc]]+0); print L"\t"g
}' /tmp/sprint_hascode.tsv /tmp/sprint_rows.tsv

# 7. Build the AREA CURRENT + AREA DIFF matrices: identical to CURRENT/DIFF but rows are the Area Path
#    (field $6) instead of the Work Item Type. The constant "E_Retain_Content\" project prefix is
#    trimmed from each path. Rows are ordered by current count desc (name asc tie-break).
awk -F'\t' -v lo="$START" -v hi="$FINISH" -v plo="$PSTART" -v phi="$PFINISH" '
BEGIN{ npref=split("New,New (edit only),Design,Approved,Committed,Active,In Progress,Blocked,Ready For Acceptance,Resolved,Done,Closed (PR/commit),Closed (no code),Rejected,Removed",pref,",")
       pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }   # prefix to strip from each area path
NF==2 { code[$1]=$2; next }
NF>=7 {
  id=$1; d=$2; s=$4; t=$6; cr=$7                             # row key t = Area Path
  if(substr(t,1,lp)==pfx){ t=substr(t,lp+1); if(t=="") t="(root)"; else if(substr(t,1,1)=="\\") t=substr(t,2) }  # strip "…\Auro Design System" prefix; bare root -> (root)
  cur=(d>=lo && d<=hi); prv=(plo!="" && d>=plo && d<=phi)
  if(!cur && !prv) next
  sc=s; sp=s
  if(s=="Closed"){ sc=(code[id]=="true")?"Closed (PR/commit)":"Closed (no code)"; sp=sc }
  else if(s=="New"){ sc=(cr>=lo&&cr<=hi)?"New":"New (edit only)"; sp=(plo!="" && cr>=plo&&cr<=phi)?"New":"New (edit only)" }
  if(cur){ c[t SUBSEP sc]++; crt[t]++; cct[sc]++; cg++; seenTc[t]=1; seenSc[sc]=1; seenSu[sc]=1 }
  if(prv){ p[t SUBSEP sp]++; prt[t]++; pct[sp]++; pg++; seenSu[sp]=1 }
  seenTu[t]=1
}
function ordcols(set,  i,s){ ncol=0; delete used
  for(i=1;i<=npref;i++){ if(pref[i] in set){ cols[++ncol]=pref[i]; used[pref[i]]=1 } }
  ne=0; delete extra
  for(s in set){ if(!(s in used)) extra[++ne]=s }
  for(i=1;i<=ne;i++) for(j=i+1;j<=ne;j++) if(extra[j]<extra[i]){x=extra[i];extra[i]=extra[j];extra[j]=x}
  for(i=1;i<=ne;i++) cols[++ncol]=extra[i] }
function ordrows(set,w,  t){ nr=0; delete rows                # rows sorted by Area Path (name) ascending
  for(t in set) rows[++nr]=t
  for(i=1;i<=nr;i++) for(j=i+1;j<=nr;j++) if(rows[j]<rows[i]){x=rows[i];rows[i]=rows[j];rows[j]=x} }
function sgn(v){ return (v>0) ? "+"v : v"" }
END{
  if(cg==0){ print "NO_ITEMS_IN_RANGE"; exit }
  print "=== AREA CURRENT ==="
  ordcols(seenSc); ordrows(seenTc, crt)
  h="Area Path"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++) L=L"\t"(c[t SUBSEP cols[cc]]+0); print L"\t"crt[t] }
  L="Total"; for(cc=1;cc<=ncol;cc++) L=L"\t"(cct[cols[cc]]+0); print L"\t"(cg+0)
  if(plo==""){ print "=== NO_PREVIOUS ==="; exit }
  print "=== AREA DIFF ==="
  for(t in seenTu) uw[t]=crt[t]+prt[t]
  ordcols(seenSu); ordrows(seenTu, uw)
  h="Area Path"; for(cc=1;cc<=ncol;cc++) h=h"\t"cols[cc]; print h"\tTotal"
  for(i=1;i<=nr;i++){ t=rows[i]; L=t; for(cc=1;cc<=ncol;cc++){ v=(c[t SUBSEP cols[cc]]+0)-(p[t SUBSEP cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(crt[t]-prt[t]) }
  L="Total"; for(cc=1;cc<=ncol;cc++){ v=(cct[cols[cc]]+0)-(pct[cols[cc]]+0); L=L"\t"sgn(v) } print L"\t"sgn(cg-pg)
}' /tmp/sprint_hascode.tsv /tmp/sprint_rows.tsv

# 8. Build the OPEN WIP list: every ticket worked during the sprint (held a state OTHER than New/Approved at some
#    moment in [START,FINISH], per its revision history) whose CURRENT state is still open (not Closed/Removed/
#    Rejected/Done). Revision history is a PER-ITEM call (GET .../workitems/{id}/revisions -- not batchable), so
#    the snapshot decides every item it can and only the rest fetch history:
#      * auto-INCLUDE: current state is a worked state (not New/Approved) AND last ChangedDate <= FINISH
#        (that worked state provably reaches into the window).
#      * auto-EXCLUDE: current state is New/Approved AND last ChangedDate < START (sat in New/Approved,
#        untouched, across the whole window).
#      * else (currently New/Approved but changed on/after START, or changed after FINISH): fetch revisions.
: > /tmp/sprint_wip_autoinc.txt; : > /tmp/sprint_wip_needhist.txt; : > /tmp/sprint_wip_qualify.txt
awk -F'\t' -v lo="$START" -v hi="$FINISH" '
{ id=$1; d=$2; s=$4
  if(s=="Closed"||s=="Removed"||s=="Rejected"||s=="Done") next       # current state -> already closed/gone
  working=(s!="New" && s!="Approved")
  if(working && d<=hi){ print id > "/tmp/sprint_wip_autoinc.txt"; next }
  if(!working && d<lo) next
  print id > "/tmp/sprint_wip_needhist.txt"
}' /tmp/sprint_rows.tsv
echo "open-wip: auto-include $(wc -l </tmp/sprint_wip_autoinc.txt|tr -d ' '), history calls $(wc -l </tmp/sprint_wip_needhist.txt|tr -d ' ')"

# One revision call per undecidable item; keep those that held a non-New/Approved state overlapping the window.
# Day-granularity: revision i covers [date_i, date_{i+1}); it overlaps [START,FINISH] when date_i<=FINISH and
# date_{i+1}>=START (the last revision runs to "9999-12-31").
while read -r id; do
  [ -z "$id" ] && continue
  ok=$(curl -sS -u ":$ADO_PAT" "$BASE/workitems/$id/revisions?api-version=7.0" \
    | jq -r --arg lo "$START" --arg hi "$FINISH" '
        [.value[] | {d:(.fields["System.ChangedDate"][:10]), s:.fields["System.State"]}] as $R
        | [ range(0; ($R|length)) as $i
            | (($R[$i].s != "New") and ($R[$i].s != "Approved")
               and ($R[$i].d <= $hi)
               and ((if ($i+1) < ($R|length) then $R[$i+1].d else "9999-12-31" end) >= $lo)) ]
        | any')
  [ "$ok" = "true" ] && echo "$id" >> /tmp/sprint_wip_qualify.txt
done < /tmp/sprint_wip_needhist.txt

# Qualifying set = auto-included + history-confirmed.
cat /tmp/sprint_wip_autoinc.txt /tmp/sprint_wip_qualify.txt | sort -u > /tmp/sprint_wip_ids.txt

# The last three tables (DONE WITH CODE, DONE NO CODE, OPEN WIP) all render a flat per-ticket list and share the same
# PR-link machinery, so it's factored into shell functions here and called for each set. First the shared connected-repo
# map, then the helpers, then the DONE sets (printed first), then OPEN WIP (printed last).

# Shared: the project's authoritative list of connected GitHub repos (GitHub Connections API -- needs the PAT's
# "GitHub Connections (Read)" scope). PR artifact refs carry no repo name, so PR numbers are resolved to real URLs by
# matching an item's area-path component against this list (correct casing, never a guessed/broken link). Map lines:
# "R<TAB><basename-lowercased><TAB><repo-url>". HTTP other than 200 (e.g. the PAT lacks the scope) => empty map =>
# every PR falls back to plain "PR #<n>" text.
CONN="https://itsals.visualstudio.com/E_Retain_Content/_apis/githubconnections"
: > /tmp/sprint_gh_repos.tsv
GHC_HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/sprint_ghc.json -w "%{http_code}" "$CONN?api-version=7.2-preview.1")
if [ "$GHC_HTTP" = "200" ]; then
  jq -r '.value[]?.id' /tmp/sprint_ghc.json | while read -r CID; do
    [ -z "$CID" ] && continue
    curl -sS -u ":$ADO_PAT" "$CONN/$CID/repos?api-version=7.2-preview.1" | jq -r '.value[]?.gitHubRepositoryUrl // empty'
  done | sort -u | awk -F'/' 'BEGIN{OFS="\t"}{ print "R", tolower($NF), $0 }' > /tmp/sprint_gh_repos.tsv
fi
echo "connected GitHub repos: $(wc -l </tmp/sprint_gh_repos.tsv|tr -d ' ') (githubconnections HTTP $GHC_HTTP)"

# relations_pass <ids-file> <out-prs> <out-commits> <out-hascode>: one batched relations fetch ($expand=relations,
# 200 ids/call) over the id set, emitting THREE files. ADO stores a PR link as an ArtifactLink "GitHub Pull Request"
# with url vstfs:///GitHub/PullRequest/<repoGuid>%2f<prNumber> (browser URL NOT stored -- only the PR number and an
# internal per-repo guid that is NOT resolvable via REST); a commit link is "GitHub Commit" .../Commit/<repoGuid>%2f<sha>.
#   out-prs:     "id<TAB>pr1,pr2,…" for ids with >=1 linked PR.
#   out-commits: "id<TAB>sha1,sha2,sha3" (first 3) for ids that have commit links but NO PR link -- Azure Boards links
#                commits and PRs INDEPENDENTLY (each artifact needs its own "AB#<id>" mention), so a ticket whose commits
#                mention it but whose PR body doesn't shows commits and no PR; those SHAs feed the commit->PR fallback.
#   out-hascode: "id<TAB>true|false" -- true iff the item has any linked GitHub commit or PR (NOT a GitHub *issue*).
relations_pass(){
  local IDS="$1" OP="$2" OC="$3" OH="$4" J N S CH
  J=$(jq -cn '[inputs|tonumber]' "$IDS"); N=$(jq 'length' <<<"$J")
  : > "$OP"; : > "$OC"; : > "$OH"
  for S in $(seq 0 200 $((N>0 ? N-1 : 0))); do
    [ "$N" -eq 0 ] && break
    CH=$(jq -c --argjson s "$S" '.[$s:$s+200]' <<<"$J")
    curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" \
      --data-binary "{\"ids\":$CH,\"\$expand\":\"relations\"}" \
      "$BASE/workitemsbatch?api-version=7.0" > /tmp/sprint_rel_chunk.json
    jq -r '.value[] | { id:.id, prs:[ (.relations // [])[] | select(.attributes.name=="GitHub Pull Request")
          | (.url | capture("PullRequest/[^%]+%2[fF](?<pr>[0-9]+)$").pr) ] | unique }
        | select((.prs|length)>0) | "\(.id)\t\(.prs|join(","))"' /tmp/sprint_rel_chunk.json >> "$OP"
    jq -r '.value[] | { id:.id,
          prs:  [ (.relations // [])[] | select(.attributes.name=="GitHub Pull Request") ],
          shas: [ (.relations // [])[] | select(.attributes.name=="GitHub Commit")
                  | (.url | capture("Commit/[^%]+%2[fF](?<s>[0-9a-fA-F]+)$").s) ] }
        | select((.prs|length)==0 and (.shas|length)>0) | "\(.id)\t\(.shas[0:10]|join(","))"' \
        /tmp/sprint_rel_chunk.json >> "$OC"
    jq -r '.value[] | "\(.id)\t\((.relations // []) | any(.rel=="ArtifactLink" and (.attributes.name=="GitHub Commit" or .attributes.name=="GitHub Pull Request")))"' \
        /tmp/sprint_rel_chunk.json >> "$OH"
  done
}

# commit_fallback <ids-file> <commits-file> <out-commitpr>: for commit-only items, ask GitHub which PR contains one of
# their commits. Resolve each item's repo from its area-path first segment against the connected-repo map (same match as
# the render), then query /repos/<owner>/<repo>/commits/<sha>/pulls for EVERY captured SHA and collect ALL candidate PRs
# (not stop-at-first). Choose one winner across all candidates by precedence: a PR whose merge_commit_sha IS this commit
# (exact -- unambiguous) beats the newest-MERGED PR (the closing work is the most-recent merge) beats any (open) PR. This
# is what stops an older unrelated PR that merely also touched the commit from being mis-reported as the fix. Uses
# $GITHUB_TOKEN if set (5000 req/hr vs 60/hr). Public repos only; a 403/rate-limit/empty response yields no fallback and is
# NOT fatal. Split SHAs with tr (portable across bash/zsh). Output "C<TAB>id<TAB>pr-number<TAB>pr-html-url" (the "C" tag
# keys it in the render join). The winner-selection jq snippet is reused verbatim by Step 3.5's prior-PR mapping.
commit_fallback(){
  local IDS="$1" COMMITS="$2" OUT="$3" WID SHAS REPOURL OWNERREPO SHA GHRESP GHLINE
  awk -F'\t' '
  BEGIN{ pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }
  $1=="R"{ repo[$2]=$3; next }
  NF==1{ keep[$1]=1; next }
  NF>=7 && ($1 in keep){
    ar=$6; if(substr(ar,1,lp)==pfx){ ar=substr(ar,lp+1); if(ar=="") ar="(root)"; else if(substr(ar,1,1)=="\\") ar=substr(ar,2) }
    base=ar; bs=index(base,"\\"); if(bs>0) base=substr(base,1,bs-1); bl=tolower(base)
    if(ar!="(root)" && (bl in repo)) print $1"\t"repo[bl]
  }' /tmp/sprint_gh_repos.tsv "$IDS" /tmp/sprint_rows.tsv > /tmp/sprint_fb_repo.tsv
  : > "$OUT"
  while IFS=$'\t' read -r WID SHAS; do
    [ -z "$WID" ] && continue
    REPOURL=$(awk -F'\t' -v i="$WID" '$1==i{print $2; exit}' /tmp/sprint_fb_repo.tsv)
    [ -z "$REPOURL" ] && continue
    OWNERREPO=${REPOURL#https://github.com/}
    : > /tmp/sprint_fb_cand.jsonl
    printf '%s\n' "$SHAS" | tr ',' '\n' | while IFS= read -r SHA; do
      [ -z "$SHA" ] && continue
      if [ -n "$GITHUB_TOKEN" ]; then
        GHRESP=$(curl -sS -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$OWNERREPO/commits/$SHA/pulls")
      else
        GHRESP=$(curl -sS -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$OWNERREPO/commits/$SHA/pulls")
      fi
      # one candidate object per PR this SHA is in: {number,url,merged_at,merge_commit_sha,exact,merged}
      jq -c --arg sha "$SHA" 'if type=="array" then .[] | {number, url:.html_url, merged_at, merge_commit_sha, exact:(.merge_commit_sha==$sha), merged:(.merged_at!=null)} else empty end' <<<"$GHRESP" 2>/dev/null
    done >> /tmp/sprint_fb_cand.jsonl
    # winner across all candidate PRs: exact merge-commit match, else newest-merged, else anything.
    GHLINE=$(jq -rs '( [ .[] | select(.exact) ] + ( [ .[] | select(.merged) ] | sort_by(.merged_at) | reverse ) + [ .[] ] ) | .[0] | if . == null then empty else "\(.number)\t\(.url)" end' /tmp/sprint_fb_cand.jsonl 2>/dev/null)
    [ -n "$GHLINE" ] && printf 'C\t%s\t%s\n' "$WID" "$GHLINE" >> "$OUT"
  done < "$COMMITS"
}

# render_pr_table <ids-file> <prs-file> <commitpr-file> <out>: 7-column flat list with a resolved PR column. FIVE inputs
# discriminated by a leading "R"/"C" tag or field count: "R" = repo map (basename-lc -> url); "C" = commit-derived PR
# (id -> number,html-url); 2 fields = ADO id->PR-numbers; 1 field = keep id; >=7 fields = work-item rows. The PR cell
# prefers ADO's directly-linked PRs (Markdown link to <repo-url>/pull/<n>, repo from the area-path first segment matched
# case-insensitively; no match / bare-root => plain "PR #<n>" text), else falls back to a commit-derived PR rendered
# "[PR #<n>](<html-url>) (via commit)", else empty. Columns: Area, Type, State, ID, PR, Title, Assigned To; sorted by
# area, type, numeric id; the ID is wrapped in a Markdown link AFTER sorting so it still sorts numerically.
render_pr_table(){
  awk -F'\t' '
  BEGIN{ pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }
  $1=="R" { repo[$2]=$3; next }
  $1=="C" { cnum[$2]=$3; curl2[$2]=$4; next }
  NF==2 { pr[$1]=$2; next }
  NF==1 { keep[$1]=1; next }
  NF>=7 && ($1 in keep){
    ar=$6
    if(substr(ar,1,lp)==pfx){ ar=substr(ar,lp+1); if(ar=="") ar="(root)"; else if(substr(ar,1,1)=="\\") ar=substr(ar,2) }
    base=ar; bs=index(base,"\\"); if(bs>0) base=substr(base,1,bs-1); bl=tolower(base)
    prcell=""
    if($1 in pr){
      np=split(pr[$1],pp,",")
      for(k=1;k<=np;k++){
        if(ar!="(root)" && (bl in repo)) link="[PR #" pp[k] "](" repo[bl] "/pull/" pp[k] ")"
        else link="PR #" pp[k]
        prcell=(prcell==""?link:prcell ", " link)
      }
    } else if($1 in cnum){
      prcell="[PR #" cnum[$1] "](" curl2[$1] ") (via commit)"
    }
    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", ar, $3, $4, $1, prcell, $9, $5
  }' /tmp/sprint_gh_repos.tsv "$3" "$2" "$1" /tmp/sprint_rows.tsv \
    | sort -t$'\t' -k1,1 -k2,2 -k4,4n \
    | awk -F'\t' 'BEGIN{OFS="\t"} { $4="[" $4 "](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/" $4 ")"; print }'
}

# render_plain_table <ids-file> <out>: 6-column flat list (no PR column -- used for DONE items that have NO linked code,
# where a PR column would always be empty). Columns: Area, Type, State, ID, Title, Assigned To; same sort + ID linking.
render_plain_table(){
  awk -F'\t' '
  BEGIN{ pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }
  NF==1 { keep[$1]=1; next }
  NF>=7 && ($1 in keep){
    ar=$6
    if(substr(ar,1,lp)==pfx){ ar=substr(ar,lp+1); if(ar=="") ar="(root)"; else if(substr(ar,1,1)=="\\") ar=substr(ar,2) }
    printf "%s\t%s\t%s\t%s\t%s\t%s\n", ar, $3, $4, $1, $9, $5
  }' "$1" /tmp/sprint_rows.tsv \
    | sort -t$'\t' -k1,1 -k2,2 -k4,4n \
    | awk -F'\t' 'BEGIN{OFS="\t"} { $4="[" $4 "](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/" $4 ")"; print }'
}

# ---- DONE tables: tickets CHANGED this sprint whose CURRENT state is a done state (Closed/Done/Rejected; Resolved and
#      Removed are NOT done -- Resolved is still-in-progress and stays in OPEN WIP, Removed is discarded), split by
#      whether they have any linked GitHub commit/PR. ----
awk -F'\t' -v lo="$START" -v hi="$FINISH" '
  $2>=lo && $2<=hi && ($4=="Closed"||$4=="Done"||$4=="Rejected"){print $1}' \
  /tmp/sprint_rows.tsv | sort -u > /tmp/sprint_done_ids.txt
relations_pass /tmp/sprint_done_ids.txt /tmp/sprint_done_prs.tsv /tmp/sprint_done_commits.tsv /tmp/sprint_done_hascode.tsv
awk -F'\t' '$2=="true"{print $1}'  /tmp/sprint_done_hascode.tsv | sort -u > /tmp/sprint_done_code_ids.txt
awk -F'\t' '$2=="false"{print $1}' /tmp/sprint_done_hascode.tsv | sort -u > /tmp/sprint_done_nocode_ids.txt
echo "done this sprint: $(wc -l </tmp/sprint_done_ids.txt|tr -d ' ') (with code $(wc -l </tmp/sprint_done_code_ids.txt|tr -d ' '), without $(wc -l </tmp/sprint_done_nocode_ids.txt|tr -d ' '))"
commit_fallback /tmp/sprint_done_code_ids.txt /tmp/sprint_done_commits.tsv /tmp/sprint_done_commitpr.tsv
render_pr_table /tmp/sprint_done_code_ids.txt /tmp/sprint_done_prs.tsv /tmp/sprint_done_commitpr.tsv > /tmp/sprint_done_code_list.tsv
render_plain_table /tmp/sprint_done_nocode_ids.txt > /tmp/sprint_done_nocode_list.tsv

# ---- OPEN WIP: the qualifying set from the revision-history pass above (still-open, worked mid-sprint). ----
relations_pass /tmp/sprint_wip_ids.txt /tmp/sprint_wip_prs.tsv /tmp/sprint_wip_commits.tsv /tmp/sprint_wip_hascode.tsv
echo "open-wip with linked PR: $(wc -l </tmp/sprint_wip_prs.tsv|tr -d ' '); commit-only (no PR) candidates: $(wc -l </tmp/sprint_wip_commits.tsv|tr -d ' ')"
commit_fallback /tmp/sprint_wip_ids.txt /tmp/sprint_wip_commits.tsv /tmp/sprint_wip_commitpr.tsv
render_pr_table /tmp/sprint_wip_ids.txt /tmp/sprint_wip_prs.tsv /tmp/sprint_wip_commitpr.tsv > /tmp/sprint_wip_list.tsv

# Print order: the two DONE tables first, then OPEN WIP last.
echo "=== DONE WITH CODE ==="
if [ ! -s /tmp/sprint_done_code_list.tsv ]; then
  echo "NO_DONE_WITH_CODE"
else
  printf 'Area Path\tWork Item Type\tCurrent State\tID\tPR\tTitle\tAssigned To\n'
  cat /tmp/sprint_done_code_list.tsv
fi

echo "=== DONE NO CODE ==="
if [ ! -s /tmp/sprint_done_nocode_list.tsv ]; then
  echo "NO_DONE_NO_CODE"
else
  printf 'Area Path\tWork Item Type\tCurrent State\tID\tTitle\tAssigned To\n'
  cat /tmp/sprint_done_nocode_list.tsv
fi

echo "=== OPEN WIP ==="
if [ ! -s /tmp/sprint_wip_list.tsv ]; then
  echo "NO_OPEN_WIP"
else
  printf 'Area Path\tWork Item Type\tCurrent State\tID\tPR\tTitle\tAssigned To\n'
  cat /tmp/sprint_wip_list.tsv
fi
```

**Validate before reporting:** confirm `query HTTP` is `200` and the fetched row count equals `TOTAL`. If the query call fails, apply the auth-failure guidance above rather than reporting an empty sprint. The `=== CURRENT ===` block's bottom-right cell is the in-range total; it's expected to be smaller than the board `TOTAL` — that's the filter working. If the awk prints `NO_ITEMS_IN_RANGE`, nothing on the board changed during that window — report that plainly instead of a table. A trailing `=== NO_PREVIOUS ===` marker (instead of `=== DIFF ===`) means there was no previous sprint — render only the current table and note it. The `open-wip:` echo reports how many revision-history calls that pass made; the last three blocks are `=== DONE WITH CODE ===`, `=== DONE NO CODE ===`, and `=== OPEN WIP ===` in that order (a `NO_DONE_WITH_CODE` / `NO_DONE_NO_CODE` / `NO_OPEN_WIP` line means that set was empty). The `=== OPEN WIP ===` block ends the output.

---

## Step 3.5 — Bug root-cause analysis (clone + blame the closed-bug fixes)

For every **closed Bug that shipped code** (the intersection of the eighth table's set with the `Bug` type), trace the fix back to the code it changed and to the pull request(s) that **last touched those same lines**, so the report (Section 8a in Step 4) can explain *why the defect slipped past that earlier review*. This step is **evidence-gathering only** — it clones the affected repos into `/tmp`, reads each fix's diff, runs `git blame` on the pre-fix lines, resolves the prior PRs, and records provenance signals; the narration (including the AI-vs-human guess) happens in Step 4. It writes one plain-text evidence file per bug at `/tmp/sprint_rca_<id>.txt`.

It **reuses files already produced by Step 3** — `/tmp/sprint_done_code_ids.txt`, `/tmp/sprint_rows.tsv`, `/tmp/sprint_done_prs.tsv`, `/tmp/sprint_done_commitpr.tsv`, `/tmp/sprint_gh_repos.tsv` — so run it **after** the Step 3 block, in the same shell (the `commit_fallback` winner-selection jq is reused here). It stays **read-only against Azure DevOps**; the only writes are the ephemeral `/tmp` clones/evidence. GitHub API calls honor `$GITHUB_TOKEN` for rate limit; cloning is anonymous (public `auro-*` repos). Partial single-branch clones (`--filter=blob:none`) keep it fast — `git blame` fetches blobs lazily.

Per bug it records: whether it is a **Support** ticket (whole-tag `Support` on the ADO work item) and, if so, **reporter evidence** (who created it, how/where it was found, severity, guest-impact, and a stripped repro/description snippet) so the render can name who/which team reported it; the **fix PR(s)** and fix commit SHA; the **fix diff** (source-file hunks only — `*.js *.ts *.mjs *.cjs *.scss *.css`); the **prior PR(s)** that last touched the pre-fix lines (via `git blame <fixsha>^` → `/commits/<sha>/pulls`, same exact-merge/newest-merged winner rule as `commit_fallback`); **who reviewed the last touch** — everyone who submitted a review or commented on the *newest* prior PR (each login tagged `human`/`bot`, so AI reviewers can be labeled separately and not counted as human review); the **contributors** (blame authors of the buggy lines, with line counts); **provenance signals** (each prior commit's author/committer and any `Co-authored-by:` / "Generated with" / AI-tool trailers — Copilot, Claude, Cursor, aider, Devin); and the **regression remedies** the fix PR itself applied (each changed file classified as post-mortem / test / story / style / source, with additions count). Edge cases are recorded inline as `SKIP`/`NOTE` markers: `repo-unresolved`, `clone-failed`, `no-fix-pr`, `fix-not-in-clone`, `no-prior-code`, `no-last-touch-pr`.

```bash
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"   # ADO — reporter lookup for Support bugs
BASE_GH="https://api.github.com"
gh_get(){  # gh_get <api-path> -> JSON on stdout; honors $GITHUB_TOKEN (higher rate limit)
  if [ -n "$GITHUB_TOKEN" ]; then
    curl -sS -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" "$BASE_GH$1"
  else
    curl -sS -H "Accept: application/vnd.github+json" "$BASE_GH$1"
  fi
}

# 1. Bug set: closed-with-code items whose type is Bug -> "id<TAB>area<TAB>title".
awk -F'\t' 'NR==FNR{keep[$1]=1;next} ($1 in keep) && $3=="Bug"{print $1"\t"$6"\t"$9}' \
  /tmp/sprint_done_code_ids.txt /tmp/sprint_rows.tsv > /tmp/sprint_rca_ids.txt

if [ ! -s /tmp/sprint_rca_ids.txt ]; then
  echo "NO_RCA_BUGS"
else
  # 2. Resolve owner/repo per bug: area first segment -> connected-repo map (same match as render_pr_table);
  #    fall back to the owner/repo embedded in the commit-derived PR URL when the area is (root)/unmapped.
  #    Files routed by leading tag: "R"=repo map, "C"=commit-derived PR row, else an rca_ids row.
  awk -F'\t' '
    BEGIN{ pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }
    $1=="R"{ repo[$2]=$3; next }
    $1=="C"{ cpr[$2]=$4; next }
    {
      id=$1; ar=$2
      if(substr(ar,1,lp)==pfx){ ar=substr(ar,lp+1); if(ar=="") ar="(root)"; else if(substr(ar,1,1)=="\\") ar=substr(ar,2) }
      base=ar; bs=index(base,"\\"); if(bs>0) base=substr(base,1,bs-1); bl=tolower(base)
      url=""
      if(ar!="(root)" && (bl in repo)) url=repo[bl]
      else if(id in cpr){ u=cpr[id]; sub(/\/pull\/.*/,"",u); url=u }
      print id"\t"(url==""?"REPO_UNRESOLVED":url)
    }' /tmp/sprint_gh_repos.tsv /tmp/sprint_done_commitpr.tsv /tmp/sprint_rca_ids.txt > /tmp/sprint_rca_repo.tsv

  # 3. Clone each distinct affected repo once (partial + single-branch; blame fetches blobs lazily).
  : > /tmp/sprint_rca_clonefail.txt
  awk -F'\t' '$2!="REPO_UNRESOLVED"{print $2}' /tmp/sprint_rca_repo.tsv | sort -u | while IFS= read -r RURL; do
    [ -z "$RURL" ] && continue
    OWNERREPO=${RURL#https://github.com/}
    DIR="/tmp/sprint_rca_$(printf '%s' "$OWNERREPO" | tr '/' '_')"
    if [ -d "$DIR/.git" ]; then
      git -C "$DIR" fetch --filter=blob:none --quiet 2>/dev/null || true
    else
      git clone --filter=blob:none --single-branch --quiet "https://github.com/$OWNERREPO.git" "$DIR" 2>/dev/null \
        || echo "$OWNERREPO" >> /tmp/sprint_rca_clonefail.txt
    fi
  done

  # 4. Per bug: fix PR(s) + fix SHA -> fix hunks -> blame pre-fix lines -> prior PRs + contributors + provenance.
  while IFS=$'\t' read -r BID BAREA BTITLE; do
    [ -z "$BID" ] && continue
    OUT="/tmp/sprint_rca_${BID}.txt"
    RURL=$(awk -F'\t' -v i="$BID" '$1==i{print $2; exit}' /tmp/sprint_rca_repo.tsv)
    { printf 'BUG\t%s\t%s\n' "$BID" "$BTITLE"; printf 'AREA\t%s\n' "$BAREA"; } > "$OUT"
    # Support flag: whole-tag "Support" in the ADO tags (col 8 of the rows file, "; "-joined). Title-level
    # flag only -- we do NOT list the other tags. If it IS a Support ticket, fetch the work item once and
    # record reporter evidence (who opened it + how/where found + a stripped repro/description snippet) so
    # the render can name who/which team reported it.
    SUP=$(awk -F'\t' -v i="$BID" '$1==i{n=split($8,t,";"); for(k=1;k<=n;k++){g=t[k]; gsub(/^ +| +$/,"",g); if(g=="Support"){print "true"; exit}}}' /tmp/sprint_rows.tsv)
    [ -z "$SUP" ] && SUP="false"
    printf 'SUPPORT\t%s\n' "$SUP" >> "$OUT"
    if [ "$SUP" = "true" ]; then
      WIJSON=$(curl -sS -u ":$ADO_PAT" "$BASE/workitems/$BID?api-version=7.0" 2>/dev/null)
      printf '%s' "$WIJSON" | jq -r '
        .fields as $f
        | "REPORTER\tcreated_by\t"  + (($f["System.CreatedBy"].displayName) // "unknown"),
          "REPORTER\thow_found\t"   + (($f["Custom.EcommDefectHowFound"]) // "" | tostring),
          "REPORTER\tenvironment\t" + (($f["AlaskaAir.Common.Custom.Environment"]) // "" | tostring),
          "REPORTER\tseverity\t"    + (($f["Microsoft.VSTS.Common.Severity"]) // "" | tostring),
          "REPORTER\timpact\t"      + (($f["Custom.ImpactedGuestExperience"]) // "" | tostring)' >> "$OUT" 2>/dev/null
      REPRO=$(printf '%s' "$WIJSON" | jq -r '.fields["Microsoft.VSTS.TCM.ReproSteps"] // .fields["System.Description"] // ""' 2>/dev/null \
        | awk '{gsub(/<[^>]*>/," "); gsub(/&nbsp;/," "); gsub(/&#39;/,"'\''"); gsub(/&quot;/,"\""); gsub(/&amp;/,"\\&"); print}' \
        | tr '\n' ' ' | awk '{gsub(/  +/," "); print substr($0,1,600)}')
      printf 'REPORTER\trepro\t%s\n' "$REPRO" >> "$OUT"
    fi
    if [ -z "$RURL" ] || [ "$RURL" = "REPO_UNRESOLVED" ]; then
      echo "SKIP	repo-unresolved" >> "$OUT"; continue
    fi
    OWNERREPO=${RURL#https://github.com/}
    DIR="/tmp/sprint_rca_$(printf '%s' "$OWNERREPO" | tr '/' '_')"
    printf 'REPO\t%s\n' "$OWNERREPO" >> "$OUT"
    if [ ! -d "$DIR/.git" ]; then
      echo "SKIP	clone-failed" >> "$OUT"; continue
    fi
    # Fix PR numbers: ADO-linked first (comma list), else the commit-derived one.
    FIXPRS=$(awk -F'\t' -v i="$BID" '$1==i{print $2; exit}' /tmp/sprint_done_prs.tsv)
    [ -z "$FIXPRS" ] && FIXPRS=$(awk -F'\t' -v i="$BID" '$1=="C" && $2==i{print $3; exit}' /tmp/sprint_done_commitpr.tsv)
    if [ -z "$FIXPRS" ]; then
      echo "SKIP	no-fix-pr" >> "$OUT"; continue
    fi
    : > /tmp/sprint_rca_blame.tsv
    : > /tmp/sprint_rca_fixfiles.tsv
    # For each fix PR: record it, dump the source hunks, blame the pre-fix lines into blame.tsv.
    printf '%s\n' "$FIXPRS" | tr ',' '\n' | while IFS= read -r FPR; do
      [ -z "$FPR" ] && continue
      PJSON=$(gh_get "/repos/$OWNERREPO/pulls/$FPR")
      FIXSHA=$(jq -r '.merge_commit_sha // empty' <<<"$PJSON" 2>/dev/null)
      FPRTITLE=$(jq -r '(.title // "") | gsub("[\t\n\r]";" ")' <<<"$PJSON" 2>/dev/null)
      FPRURL=$(jq -r '.html_url // empty' <<<"$PJSON" 2>/dev/null)
      printf 'FIXPR\t#%s\t%s\t%s\t%s\n' "$FPR" "$FPRTITLE" "$FPRURL" "$FIXSHA" >> "$OUT"
      [ -z "$FIXSHA" ] && continue
      if ! git -C "$DIR" cat-file -e "${FIXSHA}^{commit}" 2>/dev/null; then
        git -C "$DIR" fetch --filter=blob:none --quiet origin "$FIXSHA" 2>/dev/null || true
      fi
      if ! git -C "$DIR" cat-file -e "${FIXSHA}^{commit}" 2>/dev/null; then
        printf 'NOTE\tfix-not-in-clone\t#%s\n' "$FPR" >> "$OUT"; continue
      fi
      gh_get "/repos/$OWNERREPO/pulls/$FPR/files" > /tmp/sprint_rca_files.json
      # Accumulate every changed file (name + additions + status) for the regression-remedy classifier below.
      jq -r '.[] | select(.status!="removed") | [.filename,(.additions|tostring),.status] | @tsv' \
        /tmp/sprint_rca_files.json >> /tmp/sprint_rca_fixfiles.tsv 2>/dev/null
      # Fix diff (source hunks only) into the evidence file so old-vs-new is visible.
      printf -- '--- FIX DIFF (source hunks) #%s ---\n' "$FPR" >> "$OUT"
      jq -r '.[] | select(.filename|test("\\.(js|ts|mjs|cjs|scss|css)$")) | select(.patch!=null)
             | "@@FILE " + .filename + "\n" + .patch' /tmp/sprint_rca_files.json >> "$OUT" 2>/dev/null
      # Old-side ranges (filename os ol); ol==0 is a pure-addition hunk (net-new -> no prior blame).
      jq -r '.[] | select(.filename|test("\\.(js|ts|mjs|cjs|scss|css)$")) | select(.patch!=null)
             | .filename as $f | .patch | [scan("@@ -([0-9]+)(?:,([0-9]+))? \\+")] | .[]
             | "\($f)\t\(.[0])\t\(.[1] // "1")"' /tmp/sprint_rca_files.json > /tmp/sprint_rca_hunks.tsv 2>/dev/null
      while IFS=$'\t' read -r HF OS OL; do
        [ -z "$HF" ] && continue
        [ "$OL" = "0" ] && continue
        OE=$(( OS + (OL>0?OL:1) - 1 ))
        # --line-porcelain: SHA header line, then "author <name>", then the content line (tab-prefixed).
        # Options MUST precede the "--" pathspec separator, or git treats them as extra paths.
        git -C "$DIR" blame --line-porcelain -L "${OS},${OE}" "${FIXSHA}^" -- "$HF" 2>/dev/null \
          | awk 'BEGIN{a=""} /^\t/{print sha"\t"a; next}
                 ($1 ~ /^[0-9a-f]+$/ && length($1)==40){sha=$1; next}
                 /^author /{a=substr($0,8)}' >> /tmp/sprint_rca_blame.tsv
      done < /tmp/sprint_rca_hunks.tsv
    done
    # Distinct pre-fix commit SHAs (drop the all-zero "uncommitted" sentinel).
    awk -F'\t' '$1 !~ /^0+$/{print $1}' /tmp/sprint_rca_blame.tsv | sort -u > /tmp/sprint_rca_priorshas.txt
    if [ ! -s /tmp/sprint_rca_priorshas.txt ]; then
      echo "NOTE	no-prior-code" >> "$OUT"
    fi
    # Prior PRs: each prior SHA -> its winning PR (exact-merge > newest-merged > any), then dedupe by number.
    echo "--- PRIOR PRS ---" >> "$OUT"
    : > /tmp/sprint_rca_priorpr.tsv
    while IFS= read -r PSHA; do
      [ -z "$PSHA" ] && continue
      RESP=$(gh_get "/repos/$OWNERREPO/commits/$PSHA/pulls")
      jq -r --arg sha "$PSHA" '
        ( if type=="array" then . else [] end
          | map({number, url:.html_url, title:((.title // "")|gsub("[\t\n\r]";" ")), merged_at,
                 merge_commit_sha, exact:(.merge_commit_sha==$sha), merged:(.merged_at!=null)}) ) as $c
        | ( [ $c[] | select(.exact) ] + ( [ $c[] | select(.merged) ] | sort_by(.merged_at) | reverse ) + $c )
        | .[0] | if . == null then empty else "\(.number)\t\(.title)\t\(.url)\t\(.merged_at // "")" end' \
        <<<"$RESP" 2>/dev/null >> /tmp/sprint_rca_priorpr.tsv
    done < /tmp/sprint_rca_priorshas.txt
    # Dedupe by PR number and EXCLUDE the fix PR(s) themselves — a rebase-merged fix leaves same-PR commits
    # reachable from merge_commit_sha^, which would otherwise list the fix as its own "last touched by".
    sort -u /tmp/sprint_rca_priorpr.tsv \
      | awk -F'\t' -v fix="$FIXPRS" 'BEGIN{n=split(fix,f,","); for(i=1;i<=n;i++) drop[f[i]]=1} !($1 in drop) && !seen[$1]++' \
      | sort -t$'\t' -k4,4r \
      | awk -F'\t' '{print "PRIORPR\t#"$1"\t"$2"\t"$3"\t"$4}' >> "$OUT"
    # Who reviewed the last touch: the NEWEST prior PR (first PRIORPR line, sorted date-desc above) is "the
    # last touch". Gather everyone who submitted a review or commented on it -- reviews (with state), issue
    # comments, and inline code comments -- collapsing to one row per login (strongest review state wins) and
    # flagging AI bots so the render lists humans as reviewers and labels bots separately (NOT counted as human
    # review). The date is stripped to the day in the render (link + date only for "Last touched by").
    echo "--- WHO REVIEWED THE LAST TOUCH ---" >> "$OUT"
    LTNUM=$(awk -F'\t' '$1=="PRIORPR"{n=$2; gsub(/^#/,"",n); print n; exit}' "$OUT")
    LTURL=$(awk -F'\t' '$1=="PRIORPR"{print $4; exit}' "$OUT")
    LTDATE=$(awk -F'\t' '$1=="PRIORPR"{print $5; exit}' "$OUT")
    if [ -n "$LTNUM" ]; then
      printf 'LASTTOUCH\t#%s\t%s\t%s\n' "$LTNUM" "$LTURL" "$LTDATE" >> "$OUT"
      { gh_get "/repos/$OWNERREPO/pulls/$LTNUM/reviews"    | jq -r '.[]? | [.user.login, .state]     | @tsv' 2>/dev/null
        gh_get "/repos/$OWNERREPO/issues/$LTNUM/comments"  | jq -r '.[]? | [.user.login,"COMMENTED"] | @tsv' 2>/dev/null
        gh_get "/repos/$OWNERREPO/pulls/$LTNUM/comments"   | jq -r '.[]? | [.user.login,"COMMENTED"] | @tsv' 2>/dev/null
      } | awk -F'\t' '
          { login=$1; st=$2; if(login=="") next; lc=tolower(login)
            isbot = (lc ~ /\[bot\]$/ || lc ~ /sourcery|copilot|github-actions|chromatic|claassistant|dependabot|codecov|crea-ive|aurodesignsystem/) ? "bot" : "human"
            r = (st=="APPROVED" || st=="CHANGES_REQUESTED") ? 3 : 1
            if(!(login in seen) || r>rank[login]){ seen[login]=1; best[login]=st; rank[login]=r; kind[login]=isbot } }
          END{ for(l in seen) print "REVIEWER\t"l"\t"best[l]"\t"kind[l] }' >> "$OUT"
    else
      echo "NOTE	no-last-touch-pr" >> "$OUT"
    fi
    # Contributors: blame authors of the buggy lines, with line counts, most lines first.
    echo "--- CONTRIBUTORS ---" >> "$OUT"
    awk -F'\t' '$1 !~ /^0+$/{c[$2]++} END{for(a in c) print c[a]"\t"a}' /tmp/sprint_rca_blame.tsv \
      | sort -rn | awk -F'\t' '{print "CONTRIB\t"$1"\t"$2}' >> "$OUT"
    # Provenance signals: per prior SHA, author/committer + any AI/co-author trailers (lowercased match).
    echo "--- PROVENANCE SIGNALS ---" >> "$OUT"
    while IFS= read -r PSHA; do
      [ -z "$PSHA" ] && continue
      META=$(git -C "$DIR" show -s --format='%an|%cn|%s' "$PSHA" 2>/dev/null)
      BODY=$(git -C "$DIR" show -s --format='%B' "$PSHA" 2>/dev/null)
      AN=$(printf '%s' "$META" | awk -F'|' '{print $1}')
      CN=$(printf '%s' "$META" | awk -F'|' '{print $2}')
      SUBJ=$(printf '%s' "$META" | awk -F'|' '{sub(/^[^|]*\|[^|]*\|/,"");print}')
      TR=$(printf '%s' "$BODY" | awk '{l=tolower($0)} l ~ /co-authored-by:|generated with|copilot|claude|cursor|aider|devin/{gsub(/^[ \t]+/,"");print}' | tr '\n' ';')
      [ -z "$TR" ] && TR="NONE"
      SHORT=$(printf '%s' "$PSHA" | awk '{print substr($0,1,8)}')
      printf 'PROV\t%s\tauthor=%s\tcommitter=%s\ttrailers=%s\tsubject=%s\n' "$SHORT" "$AN" "$CN" "$TR" "$SUBJ" >> "$OUT"
    done < /tmp/sprint_rca_priorshas.txt
    # Regression remedies already applied by the fix PR itself: classify each changed file so the render can
    # state what the team already did to prevent recurrence (unit/story tests added, post-mortem written) and,
    # by ABSENCE, what it did not (e.g. no Playwright/e2e test). Categories: postmortem, test, story, style,
    # source, other -- with additions count so the render can say "+139 lines".
    echo "--- REGRESSION REMEDIES ---" >> "$OUT"
    awk -F'\t' '{
        f=$1; add=$2; st=$3; lf=tolower(f); cat="source"
        if(lf ~ /post-?mortem/) cat="postmortem"
        else if(lf ~ /(^|\/)test\/|\.test\.|\.spec\.|__tests__/) cat="test"
        else if(lf ~ /\.stories\.|\/stories\//) cat="story"
        else if(lf ~ /\.(scss|css)$/) cat="style"
        else if(lf ~ /\.(js|ts|mjs|cjs)$/) cat="source"
        else cat="other"
        print "REMEDY\t"cat"\t"f"\t"add"\t"st
      }' /tmp/sprint_rca_fixfiles.tsv >> "$OUT" 2>/dev/null
  done < /tmp/sprint_rca_ids.txt

  RCA_N=$(wc -l </tmp/sprint_rca_ids.txt | tr -d ' ')
  RCA_SKIP=$(cat /tmp/sprint_rca_[0-9]*.txt 2>/dev/null | awk -F'\t' '$1=="SKIP"' | wc -l | tr -d ' ')
  echo "rca bugs: $RCA_N; analyzed $((RCA_N - RCA_SKIP)); skipped $RCA_SKIP"
fi
```

**Validate before reporting:** a `NO_RCA_BUGS` line means no closed Bug shipped code this sprint — Step 4 omits Section 8a entirely. Otherwise the `rca bugs: N; analyzed M; skipped K` echo summarizes coverage, and each `/tmp/sprint_rca_<id>.txt` holds that bug's evidence (`BUG` / `AREA` / `SUPPORT` / `REPORTER` (support only) / `REPO` / `FIXPR` / `--- FIX DIFF … ---` / `--- PRIOR PRS ---` / `--- WHO REVIEWED THE LAST TOUCH ---` (`LASTTOUCH` + `REVIEWER` lines) / `--- CONTRIBUTORS ---` / `--- PROVENANCE SIGNALS ---` / `--- REGRESSION REMEDIES ---` (`REMEDY` lines), plus any `SKIP`/`NOTE` markers). A bug whose file carries a `SKIP` marker had no analyzable code (repo unresolved, clone failed, or no fix PR); a `NOTE no-prior-code` means the fix was entirely net-new lines with nothing prior to blame, and `NOTE no-last-touch-pr` means no prior PR was found to attribute reviewers to. These are expected for some bugs — don't treat them as failures.

---

## Step 4 — Report

**Output contract — read first.** The deliverable is **one continuous Markdown report rendered in your reply**. The `=== … ===` blocks that Steps 3 and 3.5 printed to the terminal are **intermediate data, not the report** — you must transcribe every one of them into Markdown in your message; the terminal stdout does **not** count as having reported them. Render **in this exact order**, top to bottom, skipping only the parts whose Step 3/3.5 sentinel says to skip:

1. CURRENT · 2. DIFF · 3. SUPPORT CURRENT · 4. SUPPORT DIFF · 5. BY ASSIGNEE · 6. AREA CURRENT · 7. AREA DIFF · 8. DONE WITH CODE · **then the Section 8a narrative** · 9. DONE NO CODE · 10. OPEN WIP · then the closing summary.

**Do not stop after Section 8a.** It is one part of the report, not the whole report — the ninth and tenth tables and the closing summary come *after* it.

Render **all ten** tables from Step 3 as clean Markdown **verbatim** — the numbers are already computed, so don't recompute or re-sort them; just wrap each tab-separated row in table syntax — **and, after the eighth table, the bug root-cause narrative (Section 8a)** narrated from the Step 3.5 evidence files. Keep the column order and the row order exactly as printed (State columns in workflow order with `New` split into `New` and `New (edit only)` and `Closed` split into `Closed (PR/commit)` and `Closed (no code)`, types by descending total), bold the `Total` row and the final `Total` column, and head each with the iteration and its date range.

**Under every table, add a plain-language description.** Between each table's heading (the `>` blockquote) and the table itself, include a one- to two-sentence description of what the table contains, written for **product managers and leadership** as the primary audience — explain in business terms what the table tells them and what insight or decision it supports, not the mechanics of how it was built (no `awk`/snapshot/revision-history talk, no column-splitting rationale). Render it as a normal italic paragraph (e.g. `*What this shows: …*`). An example description is given under each heading below; use it, adapting only the sprint-specific wording. If a table is skipped because Step 3 emitted an empty-set sentinel (`NO_SUPPORT_ITEMS`, `NO_DONE_WITH_CODE`, `NO_DONE_NO_CODE`, `NO_OPEN_WIP`, `NO_PREVIOUS`, or `NO_RCA_BUGS` for Section 8a), the description is omitted along with the table/section.

**First table — the current sprint** (the `=== CURRENT ===` block):

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — work items changed this sprint, by type and current state

*What this shows: a single-glance picture of everything the team worked on this sprint. Each row is a kind of work (user stories, bugs, tasks…) and each column is where those items stand today; the far-right **Total** is the sprint's overall volume, and the two **Closed** columns separate finished work that shipped code from finished work that didn't.*

| Work Item Type | New | New (edit only) | Approved | Committed | Active | Blocked | Ready For Acceptance | Resolved | Closed (PR/commit) | Closed (no code) | Rejected | Removed | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| User Story | 1 | 74 | 5 | 0 | 6 | 6 | 2 | 2 | 2 | 84 | 0 | 0 | **182** |
| Bug | 1 | 41 | 19 | 1 | 4 | 2 | 6 | 2 | 11 | 14 | 3 | 0 | **104** |
| Task | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 68 | 0 | 12 | **80** |
| … | | | | | | | | | | | | | |
| **Total** | **2** | **149** | **25** | **1** | **11** | **9** | **9** | **4** | **14** | **184** | **3** | **12** | **423** |

**Second table — change vs the previous sprint** (the `=== DIFF ===` block; each cell is this sprint minus the previous, so `+N` means more this sprint). Head it with both sprint names, e.g.:

> **Change vs Sprint 16.26** (2026-07-29 → 2026-08-11) — +/- in each count from the previous sprint

*What this shows: how this sprint compares with the one before it — every number is the change from last sprint (`+` means more this sprint, `-` means fewer). Use it to spot at a glance whether activity and completed work are trending up or down.*

| Work Item Type | New | New (edit only) | Approved | Committed | Active | In Progress | Blocked | Ready For Acceptance | Resolved | Closed (PR/commit) | Closed (no code) | Rejected | Removed | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| User Story | +1 | +73 | +5 | 0 | +6 | 0 | +6 | +2 | +2 | -1 | +80 | 0 | 0 | **+174** |
| Bug | +1 | +38 | +19 | +1 | +4 | 0 | +2 | +6 | +2 | +3 | +10 | -2 | 0 | **+84** |
| … | | | | | | | | | | | | | | |
| **Total** | **+2** | **+145** | **+25** | **+1** | **+10** | **-2** | **+9** | **+9** | **+4** | **+3** | **+175** | **-2** | **+12** | **+391** |

If Step 3 printed `=== NO_PREVIOUS ===` instead of a diff block, render only the first table and note there is no earlier sprint to compare against.

**Third and fourth tables — the Support-tagged subset** (the `=== SUPPORT CURRENT ===` and `=== SUPPORT DIFF ===` blocks). These are **exactly** tables 1 and 2 again — same shape, same column order and rules — but restricted to items that currently carry the `Support` tag; render them identically (bold `Total` row and final `Total` column, and head the diff with both sprint names). Because they cover a subset, only the states that actually occur among Support items appear as columns, so expect fewer columns than tables 1–2 — that's correct, not a rendering gap. If Step 3 printed `NO_SUPPORT_ITEMS`, note that no Support-tagged item changed this sprint and skip both; if it printed `=== SUPPORT NO_PREVIOUS ===`, render only the third table. Head them, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — Support-tagged work items changed this sprint, by type and current state

*What this shows: the same breakdown as the first table, limited to **Support-tagged** items — the reactive, customer- and partner-driven work. It shows how much of the sprint's capacity went to support versus planned roadmap work.* (Give the Support **change vs previous sprint** table its own one-line description too — e.g. *the sprint-over-sprint change in Support-tagged volume.*)

| Work Item Type | New (edit only) | Approved | Active | Blocked | Ready For Acceptance | Closed (PR/commit) | Closed (no code) | Rejected | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| User Story | 8 | 3 | 4 | 0 | 1 | 0 | 10 | 0 | **26** |
| Bug | 2 | 0 | 0 | 2 | 4 | 3 | 5 | 2 | **18** |
| Design Story | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | **2** |
| **Total** | **11** | **4** | **4** | **2** | **5** | **3** | **15** | **2** | **46** |

**Fifth table — the current sprint by assignee** (the `=== BY ASSIGNEE ===` block). Same state columns as the first table, but the two leading columns are **Assigned To** then **Work Item Type**, grouped by assignee: each assignee gets a sub-row per work item type followed by a bold `Subtotal` row (the subtotal is that person's total across all their types). Rows are sorted by the first column (assignee) alphabetically, then the second (type) alphabetically — so `Unassigned` sorts last. Bold the `Subtotal` rows and the final `Total` row. The awk prints the **Assigned To** name only on the first sub-row of each group and leaves it blank on the rest — render those blanks as empty cells (markdown tables can't `rowspan`, so this is how the assignee reads as one cell spanning its sub-rows); keep them blank, don't re-fill them. The grand `Total` row still equals the first table's `Total` row. Head it, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — work items changed this sprint, by assignee, type, and current state

*What this shows: the same sprint work broken out by person, so you can see how the load was distributed across the team. Each person's rows are split by work item type, and the **Subtotal** is that person's total for the sprint.*

| Assigned To | Work Item Type | New | New (edit only) | Approved | Committed | Active | Blocked | Ready For Acceptance | Resolved | Closed (PR/commit) | Closed (no code) | Rejected | Removed | **Total** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Jason Baker | Bug | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 5 | 1 | 0 | 0 | 9 |
| | User Story | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 1 | 3 | 0 | 0 | 7 |
| | **Subtotal** | **0** | **0** | **0** | **0** | **2** | **0** | **4** | **0** | **6** | **4** | **0** | **0** | **16** |
| … | | | | | | | | | | | | | | |
| Unassigned | Bug | 1 | 41 | 19 | 1 | 0 | 0 | 0 | 0 | 1 | 9 | 2 | 0 | 74 |
| | Design Story | 0 | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 23 |
| | Task | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 39 | 0 | 11 | 50 |
| | User Story | 1 | 62 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 57 | 0 | 0 | 123 |
| | **Subtotal** | **2** | **125** | **22** | **1** | **0** | **0** | **0** | **0** | **1** | **106** | **2** | **11** | **270** |
| **Total** | | **2** | **139** | **25** | **1** | **10** | **8** | **10** | **4** | **13** | **171** | **3** | **12** | **398** |

**Sixth and seventh tables — by Area Path** (the `=== AREA CURRENT ===` and `=== AREA DIFF ===` blocks). These are exactly tables 1 and 2 again, but the row label is **Area Path** instead of Work Item Type; render them the same way (bold `Total` row and final `Total` column, and for the diff table head it with both sprint names). Their `Total` rows equal tables 1 and 2. Skip the seventh table if Step 3 emitted `=== NO_PREVIOUS ===`. Head them, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — work items changed this sprint, by area path and current state

*What this shows: the same sprint activity grouped by the part of the design system it belongs to (component or product area) instead of by type — a quick read on which areas saw the most work.* (Give the area **change vs previous sprint** table its own one-line description too — e.g. *which areas got busier or quieter versus last sprint.*)

| Area Path | New | New (edit only) | … | Closed (PR/commit) | Closed (no code) | … | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|
| (root) | 0 | 45 | … | 1 | 104 | … | **170** |
| AuroDesignTokens | 0 | 8 | … | 0 | 19 | … | **29** |
| auro-formkit | 0 | 10 | … | 0 | 14 | … | **29** |
| … | | | | | | | |
| **Total** | **2** | **149** | … | **14** | **184** | … | **423** |

**Eighth table — done this sprint, with linked code** (the `=== DONE WITH CODE ===` block). A **flat list** with the same shape and columns as the tenth (open work-in-progress) table — **Area Path**, **Work Item Type**, **Current State**, **ID**, **PR**, **Title**, **Assigned To** — but scoped to tickets whose **changed date** falls in the sprint window, whose **current** state is a done state (`Closed`, `Done`, or `Rejected` — note `Resolved` is **not** done, it stays in open WIP, and `Removed` is dropped from both), **and** that have at least one linked GitHub commit or pull request. The `ID` and `PR` cells behave exactly as in the tenth table below (clickable ADO link; the PR column resolved to real GitHub URLs, `[PR #<n>](<url>) (via commit)` for the commit-derived fallback, plain `PR #<n>` text when the repo can't be resolved, or an **empty** cell for an item linked only by a commit that isn't in any resolvable PR — it still qualifies here because it *has* linked code). Render every row verbatim (already sorted by area path, then type, then ID); no totals row. If Step 3 printed `NO_DONE_WITH_CODE`, note that nothing finished this sprint had linked code and skip the table. Head it, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — done this sprint, with a linked PR/commit

*What this shows: every ticket the team **finished** this sprint that shipped actual code changes, each with a direct link to the work item and its pull request. This is the sprint's tangible engineering output.*

| Area Path | Work Item Type | Current State | ID | PR | Title | Assigned To |
|---|---|---|---:|---|---|---|
| auro-accordion | Bug | Closed | [1616757](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1616757) | [PR #228](https://github.com/AlaskaAirlines/auro-accordion/pull/228) | Stop auto-scrolling a grouped accordion that is already in view | Jason Baker |
| … | | | | | | |

**Section 8a (a narrative — NOT a table) — why did these closed bugs slip through?** (the `/tmp/sprint_rca_<id>.txt` evidence files from Step 3.5). **Render this as prose bullets, one block per bug (shape below) — never as a Markdown table.** Despite sitting after the eighth table, it is a per-bug root-cause write-up, not a tabular one; it answers, for every closed Bug that shipped code, *what code the fix changed, which PR(s) last touched those same lines, who wrote them, and why the defect wasn't caught then.* It is the prevention companion to the eighth table. **Scope note to state up front:** it covers only closed bugs **with linked code** — bugs closed without a code change have no diff to analyze. If Step 3.5 printed `NO_RCA_BUGS`, **omit this whole section** (heading and all). Head it, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — bug root-cause analysis: why did these closed bugs slip through?

*What this shows: for each bug the team fixed this sprint — flagging which came in as customer/partner **Support** tickets and who reported them — a trace from the fix back to the pull request(s) that last touched that same code, who reviewed that last touch, the people who wrote it, a best-effort guess at whether the buggy code was AI- or human-authored, a **leadership-level** explanation of the process gap that let it slip through, the prevention steps the fix already applied, and the follow-on actions still recommended. Use it to spot recurring process gaps — missing acceptance criteria, skipped TRDs, thin test coverage, over-trusting AI, single-reviewer merges — and target prevention. (Scope: closed bugs that shipped a code change; bugs closed without code aren't analyzable here.)*

**Read each `/tmp/sprint_rca_<id>.txt` and render one block per bug, grouped by component (`REPO`/`AREA`), in this shape** — ground every sentence in that file's evidence; never invent PRs, names, reviewers, or causes not present in the file. When a login appears (contributors, reviewers, provenance authors), render the **person's name** where you know it and keep the raw handle otherwise; label AI accounts (`kind=bot`, e.g. `sourcery-ai[bot]`, `Copilot`) as bots, never as people:

- **[<id>](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/<id>) — <title>** (from the `BUG` line). **If `SUPPORT` is `true`, prefix the title with a 🎫 and the word "Support"** (e.g. *🎫 Support — [<id>] …*). Do **not** list any other tags anywhere.
  - **Reported by:** *(Support tickets only — omit this bullet entirely when `SUPPORT` is `false`.)* Name who/which team reported it, read from the `REPORTER` lines — `created_by` is who opened it, and the `repro`/`how_found`/`environment` evidence often names the actual reporting team or channel (e.g. *"opened on behalf of the Flight Search team,"* found in *Regression Testing* in *Prod*). State it in one line; if the evidence only gives the creator, say that.
  - **Fix:** `[PR #<n>](<url>)` (from the `FIXPR` line) — one line on what the fix changed, read from the `--- FIX DIFF (source hunks) ---` block (the `-`/`+` lines show old vs new).
  - **Last touched by:** the prior PR list from the `PRIORPR` lines (newest first) as **link + date only** — `[PR #<n>](<url>)` followed by the date from that line (the `merged_at`, **date only, strip the time**). **Never show the PR title or a branch name here** — link and date, nothing else. Then a **Contributors:** line naming the blame authors of the buggy lines from the `CONTRIB` lines (each is `count`/`author`; most-lines-first, and you may show the line counts, e.g. *Jane Doe (7 lines), John Roe (2)*). If there are no `PRIORPR`/`CONTRIB` lines (a `NOTE no-prior-code` marker), say the buggy lines were **net-new in the fix's own history** with no earlier PR to attribute.
  - **Who reviewed the last touch (#N):** from the `--- WHO REVIEWED THE LAST TOUCH ---` block — the `LASTTOUCH` line is the specific prior PR (`#N`) these reviewers belong to. Name every **human** reviewer/commenter (`REVIEWER` lines with `kind=human`), noting their action where useful (*approved*, *requested changes*, *commented*). List any **AI reviewers** (`kind=bot`) **separately and explicitly labeled as bots** — they do **not** count as human review. **Call out a review gap** when it exists: only one human approver, or **zero** human reviewers with only bots (a real risk signal worth surfacing). If the marker is `NOTE no-last-touch-pr`, say there was no prior PR to attribute review to.
  - **Last touched by AI/Human — guess (low/med/high):** from the `--- PROVENANCE SIGNALS ---` block, a best-effort call on whether the buggy code was **AI-generated or human-written**, with a **confidence**. Ground it in evidence — an AI trailer (`trailers=` shows `Co-authored-by:` a bot, "Generated with", or a named tool like Copilot/Claude/Cursor/aider/Devin) or a bot author/committer points to AI (higher confidence); a plain human author, no such trailer, older commit era points to human. When provenance is inconclusive (`trailers=NONE`, ordinary author), **fall back to a code-style guess** from the fix diff and mark it **low** confidence. **Always prefix with "guess —"** and never state it as fact.
  - **Why it slipped through:** a **high-level, leadership-understandable process-failure assessment** — NOT a technical explanation. Written for a Product Manager or leader: *what about how we work* let this defect through. Call out **all that apply**, grounded in the evidence: missing or underspecified **requirements / acceptance criteria**; a **TRD called for but skipped**; a **coding-knowledge gap**; **missing automated or manual testing**; **over-trusting AI without verifying** its work (support this with the AI/Human guess and the reviewer bots); a **thin-review merge** (single or zero human approver); or another high-level reason. Keep it about the *process*, not the code — this is what helps the team ship more reliably.
  - **Regression Remedies Applied:** what the fix PR **already did** to prevent recurrence, grounded in the `--- REGRESSION REMEDIES ---` (`REMEDY`) lines and the fix diff — e.g. *added a unit test (`test/…`, +139 lines)*, *added a Storybook regression story*, *wrote a post-mortem (`docs/post-mortem/…`)*. Also note meaningful **absences** the evidence implies (e.g. *no Playwright/e2e test was added*, *no post-mortem*). If the only changes are source/style with no test/story/post-mortem, say the fix added **no new safety net**.
  - **Follow-on Recommendations:** concrete steps **not yet taken** that would keep this class of defect from recurring — tie each to a "Why it slipped through" cause. Examples: if acceptance criteria were missing, recommend improving the auro-ai **`ado` skill**'s acceptance-criteria generation; if an AI review (Sourcery/Copilot) flagged a Bug/Nit that was merged unfixed, or the PR merged with a single/zero human approver, recommend improving the auro-ai **`code-review` skill** to flag those and not skip them (and to require a human approver); if testing was thin, recommend the specific test type (Playwright/e2e, negative-path unit). Add any other team-level action the evidence warrants. If the fix already covers everything, say the remedies applied look sufficient and note only monitoring.
- **Bugs with a `SKIP` marker** (`repo-unresolved`, `clone-failed`, `no-fix-pr`): list the bug id + title in a short "**Not analyzed:**" line at the end of its component group with the one-word reason — don't fabricate an analysis. (Still show the 🎫 Support flag if `SUPPORT` is `true`.)
- **Data-quality note — the fix PR can be mislinked.** Two independent failure modes, both worth a one-line caveat:
  - *Commit-derived disagreement:* if the Step 3.5 evidence contradicts the eighth table's `PR` column (the tightened `commit_fallback` and the fix-PR resolution here can disagree with a stale ADO link), trust the Step 3.5 `FIXPR` and call the discrepancy out.
  - *ADO link looks unrelated to the bug:* the `FIXPR` here is whatever Azure DevOps recorded, which is **not always the real fix** — the `AB#<id>` mention that created the link can sit on an unrelated PR. **Sanity-check the `--- FIX DIFF ---` against the bug's title/symptom.** If the linked PR clearly doesn't address the described defect (e.g. a bug about *modal focus after a second Esc keypress* linked to a PR that only *renames a dropdown reference*), say so explicitly, **lower the confidence of the whole block, and note the actual fix may be linked elsewhere in the repo** (and recommend re-linking the correct PR in ADO under Follow-on Recommendations) — don't narrate a root cause as if the mislinked PR were the fix. This is a judgment only the render step can make (the bash trusts ADO's link), so it's the model's job to flag it.

**Close the whole section with a "How the team can ship more reliably" summary** (after all bug blocks): 3–6 bullets grouping the **categories of reasons** these bugs slipped through (e.g. *missing acceptance criteria*, *thin/absent automated testing*, *over-trusting AI without verification*, *single- or zero-human-approver merges*, *broad refactors that regressed one path*), each with the concrete team action that addresses it (the recurring Follow-on Recommendations — improving the `ado` and `code-review` skills, requiring a human approver, adding the missing test types). This is the leadership takeaway — keep it about process, count how many bugs each category touched, and make it actionable.

Example of a single rendered bug block (illustrative shape only — use the real evidence):

> **🎫 Support — [1613688](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1613688) — Dropdown reference is undefined after re-render**
> - **Reported by:** the Flight Search team, via Regression Testing in Prod (opened by Kyle Evitts on their behalf; Severity 2 – High).
> - **Fix:** [PR #282](https://github.com/AlaskaAirlines/auro-library/pull/282) — re-binds the trigger reference in the post-render lifecycle instead of the constructor.
> - **Last touched by:** [PR #120](https://github.com/AlaskaAirlines/auro-library/pull/120) — 2025-03-25. **Contributors:** Jane Doe (6 lines), John Roe (1).
> - **Who reviewed the last touch (#120):** John Roe (approved) — sole human approver. AI: Sourcery (commented, bot — not human review). *Review gap: single human approver.*
> - **Last touched by AI/Human — guess (low/med/high):** guess — likely human-written (med): PR #120's commit has an ordinary author and `trailers=NONE`, and the code style is hand-rolled imperative DOM wiring.
> - **Why it slipped through:** the ticket didn't call out re-render behavior as an acceptance criterion, so the case was never specified or tested; with only one human approver and a passing happy-path suite, the regression path had no gate to catch it.
> - **Regression Remedies Applied:** the fix added a unit test covering the re-render path (`test/auro-library.test.js`, +40) and a post-mortem (`docs/post-mortem/1613688.md`). No Playwright/e2e coverage was added.
> - **Follow-on Recommendations:** improve the auro-ai `ado` skill to generate lifecycle/re-render acceptance criteria for stateful components; improve the `code-review` skill to require at least one human approver and to surface unaddressed AI-review nits before merge.

**Ninth table — done this sprint, without linked code** (the `=== DONE NO CODE ===` block). The complement of the eighth — same sprint-window and done-state scope, but tickets that have **no** linked GitHub commit or pull request. Because there is never a PR to show, this table **omits the PR column**: columns are **Area Path**, **Work Item Type**, **Current State**, **ID**, **Title**, **Assigned To** (unassigned tickets show `Unassigned`). Same clickable `ID` link, same sort, no totals row. This is typically the longest of the three flat lists (most closed tickets are docs/triage/duplicate work with no code). If Step 3 printed `NO_DONE_NO_CODE`, note that every ticket finished this sprint had linked code and skip the table. Head it, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — done this sprint, no linked PR/commit

*What this shows: tickets **finished** this sprint that did not involve code changes — triage, documentation, decisions, duplicates, and the like. It captures completed work that still consumed team capacity but produced no code.*

| Area Path | Work Item Type | Current State | ID | Title | Assigned To |
|---|---|---|---:|---|---|
| (root) | Bug | Closed | [1551999](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1551999) | Auro Bug: preselecting menuoptions via the selected attribute is broken | Unassigned |
| … | | | | | |

**Tenth table — open work-in-progress** (the `=== OPEN WIP ===` block). This is a **flat list**, not a matrix — one row per ticket, columns exactly as printed: **Area Path**, **Work Item Type**, **Current State**, **ID**, **PR**, **Title**, **Assigned To** (unassigned tickets show `Unassigned`). The `ID` cell is already emitted as a Markdown link to the ADO work item (`[<id>](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/<id>)`) — keep it as-is so it renders clickable. The **PR** cell (directly after `ID`) is the ticket's linked GitHub pull request(s): tickets with a linked PR show one or more `[PR #<n>](<repo-url>/pull/<n>)` links (the repo URL is resolved against the project's connected-repo list), while tickets whose repo couldn't be resolved (bare-root items, un-connected repos, or a PAT without the GitHub Connections scope) show `PR #<n>` as **plain text**. A ticket with **no** directly-linked PR but a **commit-derived** one (recovered via GitHub's commit→PR API, because Azure Boards links commits and PRs independently) shows `[PR #<n>](<url>) (via commit)` — keep the `(via commit)` suffix so it reads as inferred rather than ADO-linked. Tickets with no PR at all show an **empty** cell. Keep all of these verbatim. Render every printed row verbatim (they're already sorted by area path, then type, then ID); there is no totals row to bold. Each ticket held a state other than New/Approved at some point in the sprint window (from its revision history) and is still open (current state not Closed/Removed/Rejected/Done) — so a few rows may show a current state of `New` or `Approved`, which is correct: those are items that were actively worked mid-sprint and have since been parked back. If Step 3 printed `NO_OPEN_WIP`, note that nothing was still-open-and-worked this sprint and skip the table. Head it, e.g.:

> **Sprint 17.26** (2026-08-12 → 2026-08-25) — open work-in-progress worked this sprint (still not closed)

*What this shows: work the team actively moved this sprint but has **not** finished — the in-flight and carry-over items heading into the next sprint. Useful for seeing what's still in motion and who's holding it.*

| Area Path | Work Item Type | Current State | ID | Title | Assigned To |
|---|---|---|---:|---|---|
| WebCoreStyleSheets | Bug | Ready For Acceptance | [1388992](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1388992) | Replace 404ing Orion documentation links on WebCoreStyleSheets feature pages | Jason Baker |
| … | | | | | |

Follow with a one-line summary. Note that counts reflect items **changed during the iteration's date range**, not the whole board; that State is each item's **current** state (not its state during the sprint); that the `New` state is split into `New` (items whose **created date** falls inside the sprint — genuinely new) and `New (edit only)` (items still in New that were created before the sprint), with the split computed per-sprint in the diff tables; that `Closed (PR/commit)` means the item has at least one linked GitHub pull request or commit (a linked GitHub *issue* alone does not count as code); that the Support-tagged tables (3 and 4) are the same as tables 1 and 2 filtered to items whose **current** tags include `Support`, so they show only the states that occur within that subset; that the diff tables span the **union** of rows/states seen in either sprint (so a row absent this sprint can still show a negative); that assignee reflects the item's **current** `Assigned To` (unassigned items are grouped as `Unassigned`, and a person may appear under more than one name spelling if the board records them inconsistently); and that Area Path rows are the item's **current** area path with the `E_Retain_Content\Auro Design System` prefix trimmed (items on that top-level node shown as `(root)`), sorted alphabetically. Note also that the tenth table (open work-in-progress) is the **only** one that uses **revision history** rather than the current snapshot: it lists tickets that held a state other than New/Approved at any moment inside the sprint window and are not currently Closed/Removed/Rejected/Done — so it deliberately surfaces items now sitting in New/Approved that were worked mid-sprint, which every other table (keyed on current state) would miss. The eighth and ninth tables (done with/without linked code) instead use the current snapshot: tickets changed in the window whose current state is Closed/Done/Rejected, split by whether they carry a linked GitHub commit or PR. Section 8a (the bug root-cause narrative, rendered right after the eighth table) traces each closed bug that shipped code back through `git blame` to the prior PR(s) and contributors that last touched the fixed lines — flagging Support tickets and their reporter, naming who reviewed that last touch (humans vs AI bots), giving an explicitly-labeled AI-vs-human authorship guess, a leadership-level why-it-slipped-through process assessment, the regression remedies the fix already applied, and follow-on recommendations — and closes with a "how the team can ship more reliably" summary. It's an interpretive aid, so its guesses are flagged as guesses and its scope (bugs with linked code only) is stated. Don't editorialize beyond the numbers.

---

## Step 5 — Offer to export the report

After the report is rendered, ask the user whether they want to save it to a file — a plain **yes/no** question:

> **"Would you like to export this report to a Markdown file? (yes/no)"**

If the answer is **no** (or anything not affirmative), stop here — the report is complete, nothing is written.

If the answer is **yes**, collect the destination in two steps, then write the file:

1. **File name** — ask, offering the current sprint's name as the default:
   > **"What should the file be named? (default: `<ITER_NAME>.md`)"**

   `<ITER_NAME>` is the iteration resolved in Step 1 (e.g. `Sprint 17.26 08.12-08.25`). If the user just accepts the default or replies empty, use `<ITER_NAME>.md`. The export is **always a Markdown file**: ensure the final name ends in `.md` — if the user supplies a name with no extension, append `.md`; if they supply a different extension (e.g. `.txt`), replace it with `.md`. (The file's contents are Markdown regardless.)
2. **Directory** — ask for the folder to save it in (no default; require an explicit path):
   > **"Which directory should I save it in? (absolute path)"**

   Verify the directory exists first with `test -d "<directory>"`. If it doesn't, tell the user and re-ask rather than writing to a missing path.

Then write the file to `<directory>/<filename>` using the **Write** tool, with **exactly** the Markdown report you just rendered in Step 4 — the same heading, all ten tables (verbatim, including each table's leadership-focused description line and the `ID`/`PR` links in the three flat tables, 8–10), the **Section 8a bug root-cause narrative** in its place right after the eighth table (unless it was omitted via `NO_RCA_BUGS`), and the closing summary. Do not recompute or re-fetch anything; reuse what was already rendered. Confirm the full path you wrote, e.g. *"Saved the report to `/Users/…/Sprint 17.26 08.12-08.25.md`."*

This export is the **only** write the skill performs, and it only ever writes a local Markdown file at the location the user specifies — it still never touches Azure DevOps work items.
