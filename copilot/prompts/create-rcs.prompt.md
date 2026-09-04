---
mode: 'agent'
description: 'Build a Release Candidate Summary (RCS) from the Auro Design System Azure DevOps board for a chosen sprint iteration. It prompts for which iteration to summarize, defaulting to the current sprint, then gathers the work items whose Iteration Path is that sprint — scoped to items under `E_Retain_Content\Auro Design System`, excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative/Design Story/Task work item types, limited to items whose State is Committed/Blocked/Active/Ready For Acceptance/Resolved/Closed, and excluding anything tagged `auro-rcs` (so a re-run never gathers the skill''s own Release tickets) — and lists them grouped by the Area Path they sit in, collapsing any area under `E_Retain_Content\Auro Design System\auro-formkit` into a single `auro-formkit` group. It then plans a `Release <area> - <iteration>` User Story per area — set to the iteration, on the area''s path, State Blocked, Target Date set to the iteration''s last day, tagged `auro-rcs`, with Predecessor links to every ticket in that area and child `Generate Release Notes` and `Update Dependencies` Tasks. Before creating anything it reconciles existing links: a predecessor already linked (via the `auro-rcs` tag) to a Release ticket in another sprint can be moved to this sprint''s ticket, and an area already linked to a this-sprint Release ticket can reuse it instead of creating a duplicate. The skill plans the full change set, shows it, and writes to Azure DevOps — creating work items and adding/removing links — only after the user confirms at a submit gate.'
tools: ['runCommands']
---

<!-- Generated from plugins/auro/skills/create-rcs/SKILL.md by scripts/build-copilot-prompts.mjs. Do not edit by hand. -->

## Task — start now

Build the RCS by running the steps below **in order**. Step 1 prompts the user to pick an iteration (defaulting to the current sprint) — ask, wait for the reply, and resolve it before continuing. **Steps 1–2 and the planning phase of Step 3 are strictly read-only** against Azure DevOps (org `itsals`, project `E_Retain_Content`). Step 3 then **plans** every change — new Release work items plus any link add/removes from reconciliation — shows the user the full change set, and **writes to Azure DevOps only after the user confirms at the submit gate**, at which point it creates work items and adds/removes links. **Send no `POST`/`PATCH` before that gate.**

**Azure DevOps access (PAT).** Every ADO REST call authenticates with a **Personal Access Token** in the `ADO_PAT` environment variable via HTTP Basic auth with an **empty username**: `curl -u ":$ADO_PAT"`.
- **Before the first ADO call,** verify the token is present: `` [ -n "$ADO_PAT" ] ``. If it's empty, stop and tell the user: *"No Azure DevOps token found. Create a PAT at https://itsals.visualstudio.com/_usersSettings/tokens with **Work Items (Read & Write)** scope (Read is enough for Steps 1–2 and Step 3's planning phase; Write is required only when you confirm submission), then `export ADO_PAT=<token>` in your shell and re-run."*
- **Detect auth failures, don't mistake them for empty results.** ADO answers an unauthenticated/insufficient request with its sign-in **HTML page** (HTTP 203, or a body starting with `<!DOCTYPE` / containing `Azure DevOps Services | Sign In`) or a 302/401. If any call returns a status other than `200`, or the body isn't the expected JSON, treat it as an **auth failure** — the PAT is missing, expired, or lacks scope — and show the same PAT guidance above. Never report it as an empty sprint or invent `az login` commands.
- **Never** print the PAT, echo `$ADO_PAT`, or write it to a file — always reference it as the `$ADO_PAT` variable in the command.

---

## Step 1 — Choose the iteration (sprint), defaulting to current

Fetch the project's iterations, present the active sprints, and ask the user which one to summarize — defaulting to the current sprint if they don't pick one. Run this block (it writes two helper files: the numbered pick-list and the full set for name lookups):

```bash
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_iters.json -w "%{http_code}" \
  "$BASE/classificationnodes/Iterations?\$depth=10&api-version=7.0")
echo "iterations HTTP: $HTTP"   # must be 200 — anything else is an auth failure (see access rules)
TODAY=$(date -u +%Y-%m-%d)

# All dated iterations (name, dates, node path) -> used to resolve a name the user types.
jq '[ [ .. | objects | select(.attributes?.startDate != null) ]
      | .[] | {name, start: .attributes.startDate[:10], finish: .attributes.finishDate[:10], path} ]' \
  /tmp/rcs_iters.json > /tmp/rcs_iter_all.json

# Presented pick-list: top-level sprints only (exclude the Archive / Content Migration folders),
# most recent first. Number N in the printed list maps to element N-1 here.
jq '[ .children[] | select(.attributes?.startDate != null)
      | {name, start: .attributes.startDate[:10], finish: .attributes.finishDate[:10], path} ]
    | sort_by(.start) | reverse' \
  /tmp/rcs_iters.json > /tmp/rcs_iter_list.json

echo "=== Iterations (most recent first) ==="
jq -r --arg today "$TODAY" '
  (map(select(.start <= $today and $today <= .finish)) | .[0].start) as $curstart
  | to_entries[]
  | "\(.key+1)) \(.value.name)   [\(.value.start) → \(.value.finish)]"
    + (if (.value.start <= $today and $today <= .value.finish) then "   ← current" else "" end)
' /tmp/rcs_iter_list.json
```

Present that numbered list to the user and ask: **"Which iteration should I summarize? Reply with a number from the list, a sprint name, or `current` — the default is the current sprint, so reply `current` (or just confirm) to use it. Older sprints not shown (the Archive) can be selected by name."**

**Resolve their reply** to a single iteration and capture its `ITER_NAME`, `ITER_PATH` (the Iteration Path used to filter work items), `START`, and `FINISH`:
- **An empty reply, or `current`** → the list entry whose range contains today (the one marked `← current`). If today falls in no iteration, say so and ask them to pick from the list.
- **A number `N`** → element `N-1` of `/tmp/rcs_iter_list.json`.
- **A name (or partial name)** → match case-insensitively against the full set (which includes archived sprints):
  ```bash
  SEL="<what the user typed>"
  jq -r --arg q "$SEL" '[ .[] | select(.name | ascii_downcase | contains($q | ascii_downcase)) ]
    | if length==0 then "NO_MATCH"
      elif length==1 then (.[0] | "\(.name)\t\(.start)\t\(.finish)\t\(.path)")
      else "MULTI: " + ([ .[].name ] | join(" | ")) end' /tmp/rcs_iter_all.json
  ```
  `NO_MATCH` → tell them and re-ask. `MULTI:` → show the matches and ask them to narrow it. A single match → use it.

**Iteration names contain spaces** (e.g. `Sprint 17.26 08.12-08.25`), so the resolution output is **tab-separated** — never whitespace-split it. Read fields directly with jq (e.g. `jq -r '.[N-1].name'`, `.[N-1].path`, etc.).

**Derive `ITER_PATH` from the iteration's classification-node `path`.** The node `path` looks like `\E_Retain_Content\Iteration\<name>` (or nested `…\Iteration\<parent>\<child>`), but the queryable **Iteration Path** field drops the leading backslash and the `Iteration` classification segment — e.g. `\E_Retain_Content\Iteration\Sprint 17.26 08.12-08.25` → `E_Retain_Content\Sprint 17.26 08.12-08.25`. Convert it:
```bash
NODE_PATH="<the resolved iteration's .path>"
ITER_PATH=$(printf '%s' "$NODE_PATH" | sed -e 's#^\\##' -e 's#\\Iteration\\#\\#')
echo "ITER_PATH: $ITER_PATH"
```
Set `ITER_NAME`, `ITER_PATH`, `START`, and `FINISH` before continuing. Never guess the path — it must come from the selected iteration's node.

Tell the user which sprint you resolved, e.g. **"Summarizing **`<ITER_NAME>`** (`<START>` → `<FINISH>`) — gathering every work item assigned to that iteration."**

---

## Step 2 — Gather the iteration's work items, grouped by Area Path

A WIQL query returns only work item **IDs**, so this runs in two stages: query for the IDs of the items whose Iteration Path is `ITER_PATH`, then batch-fetch each item's fields and group them by Area Path. The query is **scoped to items under `E_Retain_Content\Auro Design System`** (so bare-root ComMod/Content work sharing the sprint is excluded), **excludes the `Test Case`, `Test Plan`, `Test Suite`, `Epic`, `Feature`, `Initiative`, `Design Story`, and `Task` work item types**, is **limited to items whose State is one of `Committed`, `Blocked`, `Active`, `Ready For Acceptance`, `Resolved`, or `Closed`** (so `New`, `Approved`, `Design`, `Rejected`, `Removed`, and `Done` items are left out), and **excludes anything tagged `auro-rcs`**. The last two filters keep the skill's own output out of the gather on a re-run — the Release User Stories it creates are tagged `auro-rcs` and land on this sprint's path in State Blocked, and their child `Generate Release Notes` / `Update Dependencies` items are Tasks — so without them a second run would gather its own Release tickets and re-link them as predecessors. Run it with `ITER_PATH` from Step 1:

```bash
ITER_PATH="<ITER_PATH>"   # from the chosen iteration
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"

# 1. WIQL: the work items whose Iteration Path is this sprint (flat -> id references only), scoped to
#    items UNDER "E_Retain_Content\Auro Design System" (excludes bare-root ComMod/Content work),
#    excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative/Design Story/Task work item types, and
#    limited to items whose State is one of Committed/Blocked/Active/Ready For Acceptance/Resolved/Closed
#    (so New/Approved/Design/Rejected/Removed/Done items are left out). The Task exclusion plus the
#    `NOT CONTAINS 'auro-rcs'` clause keep this skill's OWN output out of the gather on a re-run: the
#    Release User Stories it creates are tagged `auro-rcs` (and are Blocked, an included State, on this
#    sprint's path), and their `Generate Release Notes` / `Update Dependencies` children are Tasks — without
#    these two filters a second run would pick up its own Release tickets and link them as predecessors.
#    Single-quotes in the path are ADO-escaped by doubling them.
ESC_PATH=$(printf '%s' "$ITER_PATH" | sed "s/'/''/g")
QUERY="SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '$ESC_PATH' AND [System.AreaPath] UNDER 'E_Retain_Content\\Auro Design System' AND [System.WorkItemType] NOT IN ('Test Case','Test Plan','Test Suite','Epic','Feature','Initiative','Design Story','Task') AND [System.State] IN ('Committed','Blocked','Active','Ready For Acceptance','Resolved','Closed') AND [System.Tags] NOT CONTAINS 'auro-rcs' ORDER BY [System.Id]"
BODY=$(jq -cn --arg q "$QUERY" '{query:$q}')
HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_wiql.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" --data-binary "$BODY" \
  "$BASE/wiql?api-version=7.0")
echo "query HTTP: $HTTP"   # must be 200

# 2. Batch-fetch id + title + type + state + assignee + area path in chunks of 200 ->
#    "id<TAB>type<TAB>state<TAB>assignee<TAB>area<TAB>title"
#    (assignee display name or "Unassigned"; title has embedded tabs/newlines squashed to spaces).
: > /tmp/rcs_rows.tsv
IDS_JSON=$(jq -c '[.workItems[].id]' /tmp/rcs_wiql.json)
TOTAL=$(jq 'length' <<<"$IDS_JSON")
echo "work items in iteration: $TOTAL"
for S in $(seq 0 200 $((TOTAL>0 ? TOTAL-1 : 0))); do
  [ "$TOTAL" -eq 0 ] && break
  CHUNK=$(jq -c --argjson s "$S" '{ids: .[$s:$s+200], fields:["System.WorkItemType","System.State","System.AssignedTo","System.AreaPath","System.Title"]}' <<<"$IDS_JSON")
  curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" --data-binary "$CHUNK" \
    "$BASE/workitemsbatch?api-version=7.0" \
  | jq -r '.value[] | "\(.id)\t\(.fields["System.WorkItemType"])\t\(.fields["System.State"])\t\(.fields["System.AssignedTo"].displayName // "Unassigned")\t\(.fields["System.AreaPath"])\t\((.fields["System.Title"] // "") | gsub("[\t\n\r]"; " "))"' >> /tmp/rcs_rows.tsv
done
echo "fetched rows: $(wc -l </tmp/rcs_rows.tsv | tr -d ' ') of $TOTAL"

# 3. Split into TWO top-level groups, then group by Area Path within the second:
#    Group 1 (ROOT)  — tickets filed directly on the "E_Retain_Content\Auro Design System" node.
#    Group 2 (OTHER) — every other ticket, still sub-grouped by Area Path. Any area at or under
#                      "E_Retain_Content\Auro Design System\auro-formkit" collapses to a single
#                      "auro-formkit" sub-group; other areas have the constant prefix trimmed for readability.
#    The output brackets each top-level group with "@@@ GROUP 1: Root ... @@@" / "@@@ GROUP 2: By area ... @@@"
#    banners; within each, "=== <sub-group>  (<count>) ===" blocks list rows sorted by id. Sub-groups in
#    Group 2 are alphabetical.
awk -F'\t' '
BEGIN{ fk="E_Retain_Content\\Auro Design System\\auro-formkit"; lfk=length(fk)
       pfx="E_Retain_Content\\Auro Design System"; lp=length(pfx) }
{
  id=$1; type=$2; state=$3; who=$4; area=$5; title=$6
  # collapse anything at or under the auro-formkit area into one "auro-formkit" group
  if(area==fk || substr(area,1,lfk+1)==fk"\\"){ g="auro-formkit" }
  else if(substr(area,1,lp)==pfx){ g=substr(area,lp+1); if(g=="") g="(root)"; else if(substr(g,1,1)=="\\") g=substr(g,2) }
  else g=area
  key=g
  grp[key]=1; cnt[key]++
  rows[key]=rows[key] sprintf("%s\t%s\t%s\t%s\t%s\n", id, type, state, who, title)
}
END{
  # ---- Group 1: root tickets (the "(root)" sub-group only) ----
  print "@@@ GROUP 1: Root — Auro Design System  (" (cnt["(root)"]+0) ") @@@"
  if("(root)" in grp){ print "=== (root)  (" cnt["(root)"] ") ==="; printf "%s", rows["(root)"] }
  # ---- Group 2: everything else, alphabetical by area sub-group ----
  n=0; ocount=0
  for(k in grp){ if(k=="(root)") continue; keys[++n]=k; ocount+=cnt[k] }
  for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(keys[j]<keys[i]){x=keys[i];keys[i]=keys[j];keys[j]=x}
  print "@@@ GROUP 2: By area  (" ocount ") @@@"
  for(i=1;i<=n;i++){ k=keys[i]; print "=== " k "  (" cnt[k] ") ==="; printf "%s", rows[k] }
}' /tmp/rcs_rows.tsv > /tmp/rcs_grouped.txt
cat /tmp/rcs_grouped.txt
```

**Render the grouped list for the user.** Present it as **two top-level groups**, in the order the output emits them:
1. **`@@@ GROUP 1: Root … @@@`** — the tickets filed directly on the Auro Design System node. If there are none, say so and skip the section.
2. **`@@@ GROUP 2: By area … @@@`** — all other tickets, kept sub-grouped by area (each `=== <sub-group>  (<count>) ===` block, alphabetical, `auro-formkit` collapsed).

For each `=== <sub-group>  (<count>) ===` block, print a heading and a compact table of its work items with columns **ID · Type · State · Assigned To · Title**. Lead with a one-line summary of the total item count and how it splits across the two groups. If the query returned zero items, tell the user the iteration has no eligible work items assigned to it. Then continue to Step 3.

---

## Step 3 — Reconcile Release links, plan the changes, then submit on confirmation

For each **Group 2** area sub-group (skip the `(root)` group), the skill plans a parent **User Story** titled `Release <area> - <iteration>` plus its child **Tasks** `Generate Release Notes` and `Update Dependencies`. It runs in phases: **3A** builds the drafts and scans for existing links (read-only), **3B** shows the full change set, **3C** asks the user to confirm, **3D** performs the ADO writes only on a yes, and **3E** reports what changed. **Nothing is written to Azure DevOps before the 3C gate.**

Every Release ticket the skill creates is stamped with the tag **`auro-rcs`** (`System.Tags`). That tag is how the skill recognizes its *own* Release tickets when reconciling — it never treats an untagged or legacy "release"-titled work item as one of its Release tickets.

Each planned **parent User Story** carries:
- **Title:** `Release <area> - <ITER_NAME>` (`<area>` = the sub-group label, e.g. `auro-formkit`, `auro-hyperlink`, `AuroDocsSite`).
- **Work item type:** `User Story`.
- **Iteration Path:** `ITER_PATH` (the iteration being worked).
- **Area Path:** the sub-group's area — `E_Retain_Content\Auro Design System\<area>` (for the collapsed `auro-formkit` group this is exactly the `…\auro-formkit` node).
- **State:** `Blocked`.
- **Target Date:** `Microsoft.VSTS.Scheduling.TargetDate` = the iteration's last day (`FINISH`).
- **Tag:** `auro-rcs` (`System.Tags`) — the marker the skill uses to recognize its own Release tickets.
- **Predecessor links:** one `System.LinkTypes.Dependency-Reverse` (**Predecessor**) relation to **every** ticket in that area sub-group, so the release gates on all of them.
- **Description** and **Acceptance Criteria** as drafted below.

**Large-text fields are written as Markdown, not HTML.** `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` default to HTML — which collapses the drafted `\n\n` line breaks, `**bold**`, and `` `code` `` into one unformatted run. So every payload that writes one of these fields also sends a companion op `{op:"add",path:"/multilineFieldsFormat/<ref>",value:"Markdown"}`, and the create/update calls use **`api-version=7.1`** (7.0 silently ignores `multilineFieldsFormat` and stores the content as HTML). ADO only applies the format op when the field's value actually changes, so any later reformat of an existing ticket must send a changed value alongside the op.

Each **child Task** (`Generate Release Notes`, `Update Dependencies`) carries the same Area Path / Iteration Path and its Markdown description below (with its own `multilineFieldsFormat` op). During planning (3A) the child payloads are written without a parent link; at submit time (3D) the parent story is created first, then each Task is created with a `System.LinkTypes.Hierarchy-Reverse` (**Parent**) link to the new story's id.

**Validate the parent State first (per this run's rule).** Fetch the allowed States for `User Story` and confirm `Blocked` is among them:
```bash
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
curl -sS -u ":$ADO_PAT" "$BASE/workItemTypes/User%20Story/states?api-version=7.0" \
  | jq -r '.value[]?.name' > /tmp/rcs_us_states.txt
grep -qx "Blocked" /tmp/rcs_us_states.txt && echo "STATE_OK" || echo "STATE_INVALID"
```
If it prints `STATE_INVALID`, **stop** and ask the user which State to use for the Release stories instead of `Blocked`; otherwise continue with `Blocked`.

### 3A — Build the drafts and scan existing links (read-only)

**Build the drafts.** Run this block (it re-labels the fetched rows into area sub-groups, then writes JSON-patch payloads per area under `/tmp/rcs_draft_*` — a parent User Story plus two child Tasks (Generate Release Notes, Update Dependencies) — and prints a readable draft for each). It writes nothing to ADO. It expects `ITER_NAME`, `ITER_PATH`, and `FINISH` from Step 1 and `/tmp/rcs_rows.tsv` from Step 2:

```bash
ITER_NAME="<ITER_NAME>"; ITER_PATH="<ITER_PATH>"; FINISH="<FINISH>"   # from Step 1 (FINISH = iteration's last day, YYYY-MM-DD)
TARGET_DATE="${FINISH}T00:00:00Z"   # Release story Target Date = last day of the iteration
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
ORG_WI="https://itsals.visualstudio.com/_apis/wit/workItems"   # work-item URL stem for relation links
PFX='E_Retain_Content\Auro Design System'
RCS_TAG="auro-rcs"                             # tag stamped on every Release ticket this skill creates
setopt local_options no_nomatch 2>/dev/null   # zsh: don't abort on an empty glob (bash ignores this line)
rm -f /tmp/rcs_draft_*.json 2>/dev/null        # clear any prior drafts

# Re-label each fetched row into its area sub-group (same rules as Step 2), skipping (root).
# Emits: "<label>\t<id>\t<type>\t<state>\t<who>\t<title>". The prefix is hardcoded INSIDE the awk
# program (never passed via -v: awk would mangle the backslashes as escape sequences).
awk -F'\t' '
BEGIN{ pfx="E_Retain_Content\\Auro Design System"; fk=pfx"\\auro-formkit"; lfk=length(fk); lp=length(pfx) }
{ id=$1;type=$2;state=$3;who=$4;area=$5;title=$6
  if(area==fk || substr(area,1,lfk+1)==fk"\\") g="auro-formkit"
  else if(substr(area,1,lp)==pfx){ g=substr(area,lp+1); if(g==""){next} else if(substr(g,1,1)=="\\")g=substr(g,2) }
  else g=area
  if(g=="(root)") next
  print g"\t"id"\t"type"\t"state"\t"who"\t"title }' /tmp/rcs_rows.tsv | sort > /tmp/rcs_labeled.tsv

AREAS=$(cut -f1 /tmp/rcs_labeled.tsv | sort -u)
echo "Planning Release work items for $(echo "$AREAS" | grep -c .) areas (nothing written to ADO yet)."
echo

while IFS= read -r AREA; do
  [ -z "$AREA" ] && continue
  SAFE=$(printf '%s' "$AREA" | tr '\\/ ' '___')
  AREA_PATH="$PFX\\$AREA"
  TITLE="Release $AREA - $ITER_NAME"

  # predecessor ids for this area
  IDS=$(awk -F'\t' -v a="$AREA" '$1==a{print $2}' /tmp/rcs_labeled.tsv)

  DESC="**Release coordination for \`$AREA\` — $ITER_NAME.**

This work item manages the release flow for the \`$AREA\` area of the Auro Design System. It is the single gate for cutting and shipping the \`$AREA\` release candidate (RC) this iteration.

- Every work item completed for \`$AREA\` this iteration is linked as a **Predecessor** of this item — those are the changes bundled into this release.
- This item stays **Blocked** until all predecessor work is complete.
- Its child tasks prepare the release: **Generate Release Notes** produces the release-notes document that ships with the release, and **Update Dependencies** reviews and updates the NPM dependencies for the area.

Use this ticket as the go/no-go checkpoint for the \`$AREA\` release."

  AC="- [ ] **The release candidate has been re-tested** — the \`$AREA\` RC has been re-tested and verified to pass after all predecessor work merged.
- [ ] **The release has been cut** — once all predecessor work items are closed and test validation is complete and passing, the release-candidate PR is merged into the \`main\` branch."

  CHILD_DESC="Create the release-notes document for the \`$AREA\` release ($ITER_NAME) and include it in the release.

The release notes must:
- Summarize every work item shipped in this release (all Predecessors of *$TITLE*) — new features, bug fixes, and any breaking changes.
- Be reviewed for accuracy and completeness.
- Be attached to / linked from the release so it ships with the \`$AREA\` release candidate."

  CHILD2_DESC="Review and update the NPM dependencies for the \`$AREA\` release ($ITER_NAME).

Check both \`dependencies\` and \`devDependencies\` for this area to determine whether any updates should be made, and execute on them where appropriate:
- Identify outdated packages (e.g. via \`npm outdated\`) across \`dependencies\` and \`devDependencies\`.
- Determine which updates are appropriate for this release — prioritizing security and bug-fix updates, and evaluating major-version bumps for breaking changes.
- Apply the appropriate updates, refresh the lockfile, and verify the build and tests still pass.
- Note any updates intentionally deferred so they can be revisited in a future release."

  # predecessor relation ops -> JSON array. Pass values via --arg (never interpolate backslash-laden
  # shell vars into the jq program text — jq would choke on "\A", "\D", etc.).
  PREDS=$(printf '%s\n' "$IDS" | jq -R --arg stem "$ORG_WI" --arg area "$AREA" '
    select(length>0) | {op:"add",path:"/relations/-",value:{rel:"System.LinkTypes.Dependency-Reverse",url:($stem+"/"+.),attributes:{comment:("RC predecessor — bundled into the "+$area+" release")}}}' | jq -s '.')

  # parent User Story JSON-patch payload (planned, not yet submitted). Target Date = last day of the
  # iteration; tagged auro-rcs so the skill can recognize its own Release tickets later.
  jq -n --arg title "$TITLE" --arg area "$AREA_PATH" --arg iter "$ITER_PATH" \
        --arg desc "$DESC" --arg ac "$AC" --arg target "$TARGET_DATE" --arg tag "$RCS_TAG" --argjson preds "$PREDS" '
    [ {op:"add",path:"/fields/System.Title",value:$title},
      {op:"add",path:"/fields/System.AreaPath",value:$area},
      {op:"add",path:"/fields/System.IterationPath",value:$iter},
      {op:"add",path:"/fields/System.State",value:"Blocked"},
      {op:"add",path:"/fields/Microsoft.VSTS.Scheduling.TargetDate",value:$target},
      {op:"add",path:"/fields/System.Tags",value:$tag},
      {op:"add",path:"/fields/System.Description",value:$desc},
      {op:"add",path:"/fields/Microsoft.VSTS.Common.AcceptanceCriteria",value:$ac},
      {op:"add",path:"/multilineFieldsFormat/System.Description",value:"Markdown"},
      {op:"add",path:"/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria",value:"Markdown"} ] + $preds
  ' > "/tmp/rcs_draft_${SAFE}_parent.json"

  # child Task JSON-patch payloads (NOT submitted; Parent link added at submit time once the story exists)
  jq -n --arg title "Generate Release Notes" --arg area "$AREA_PATH" --arg iter "$ITER_PATH" \
        --arg desc "$CHILD_DESC" '
    [ {op:"add",path:"/fields/System.Title",value:$title},
      {op:"add",path:"/fields/System.AreaPath",value:$area},
      {op:"add",path:"/fields/System.IterationPath",value:$iter},
      {op:"add",path:"/fields/System.Description",value:$desc},
      {op:"add",path:"/multilineFieldsFormat/System.Description",value:"Markdown"} ]
  ' > "/tmp/rcs_draft_${SAFE}_child_notes.json"

  jq -n --arg title "Update Dependencies" --arg area "$AREA_PATH" --arg iter "$ITER_PATH" \
        --arg desc "$CHILD2_DESC" '
    [ {op:"add",path:"/fields/System.Title",value:$title},
      {op:"add",path:"/fields/System.AreaPath",value:$area},
      {op:"add",path:"/fields/System.IterationPath",value:$iter},
      {op:"add",path:"/fields/System.Description",value:$desc},
      {op:"add",path:"/multilineFieldsFormat/System.Description",value:"Markdown"} ]
  ' > "/tmp/rcs_draft_${SAFE}_child_deps.json"

  # readable draft — use printf '%s' so backslashes in area/iteration paths
  # (e.g. \auro-*) are printed literally and not eaten as echo escapes (\a = bell)
  PCOUNT=$(printf '%s\n' "$IDS" | grep -c .)
  PREDLIST=$(printf '%s' "$IDS" | tr '\n' ' ')   # one space-separated line (zsh doesn't word-split unquoted $IDS)
  printf '%s\n' "──────────────────────────────────────────────"
  printf 'AREA: %s\n' "$AREA"
  printf '  PARENT  User Story  "%s"\n' "$TITLE"
  printf '    Area Path:      %s\n' "$AREA_PATH"
  printf '    Iteration:      %s\n' "$ITER_PATH"
  printf '    State:          %s\n' "Blocked"
  printf '    Target Date:    %s\n' "$TARGET_DATE"
  printf '    Predecessors:   %s  ->  %s\n' "$PCOUNT" "$PREDLIST"
  printf '  CHILD   Task        "Generate Release Notes"  (Parent -> "%s")\n' "$TITLE"
  printf '  CHILD   Task        "Update Dependencies"     (Parent -> "%s")\n' "$TITLE"
  printf '  payloads: /tmp/rcs_draft_%s_parent.json , /tmp/rcs_draft_%s_child_notes.json , /tmp/rcs_draft_%s_child_deps.json\n' "$SAFE" "$SAFE" "$SAFE"
  printf '\n'
done <<< "$AREAS"

echo "Draft payloads written under /tmp/rcs_draft_*.json (nothing submitted yet)."
```

**Scan for existing Release links (read-only).** Run this block. For every ticket in the sprint it finds any link to one of the skill's own Release tickets (tag `auro-rcs`) and classifies it `this` (same iteration) or `other`. Results go to `/tmp/rcs_links.tsv` (`area  ticketId  releaseId  releaseIter  class  releaseTitle`). A ticket sits on the **Successor** side (`System.LinkTypes.Dependency-Forward`) of the link the skill creates, so that is what the scan follows:

```bash
ITER_PATH="<ITER_PATH>"   # from Step 1 (re-declared: each block runs in a fresh shell)
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
RCS_TAG="auro-rcs"
: > /tmp/rcs_succ.tsv; : > /tmp/rcs_releases.tsv; : > /tmp/rcs_links.tsv

# 1) every sprint ticket's Successor (Dependency-Forward) targets -> "ticketId <TAB> candidateReleaseId"
ALL_IDS=$(cut -f2 /tmp/rcs_labeled.tsv | sort -un)
ID_ARR=$(printf '%s\n' "$ALL_IDS" | jq -R 'select(length>0)|tonumber' | jq -sc '.')
CNT=$(jq 'length' <<<"$ID_ARR")
for S in $(seq 0 200 $((CNT>0 ? CNT-1 : 0))); do
  [ "$CNT" -eq 0 ] && break
  CHUNK=$(jq -c --argjson s "$S" '{ids:.[$s:$s+200],"$expand":"relations"}' <<<"$ID_ARR")
  curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" --data-binary "$CHUNK" \
    "$BASE/workitemsbatch?api-version=7.0" \
  | jq -r '.value[] | .id as $t | (.relations[]? | select(.rel=="System.LinkTypes.Dependency-Forward")
           | "\($t)\t\(.url | sub(".*/[wW]ork[iI]tems/";""))")' >> /tmp/rcs_succ.tsv
done

# 2) of those link targets, keep only the ones tagged auro-rcs; classify by iteration
CAND=$(cut -f2 /tmp/rcs_succ.tsv | sort -un)
if [ -n "$CAND" ]; then
  CAND_ARR=$(printf '%s\n' "$CAND" | jq -R 'select(length>0)|tonumber' | jq -sc '.')
  CC=$(jq 'length' <<<"$CAND_ARR")
  for S in $(seq 0 200 $((CC-1))); do
    RCH=$(jq -c --argjson s "$S" '{ids:.[$s:$s+200],fields:["System.Tags","System.IterationPath","System.Title"]}' <<<"$CAND_ARR")
    curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" --data-binary "$RCH" \
      "$BASE/workitemsbatch?api-version=7.0" \
    | jq -r --arg tag "$RCS_TAG" --arg iter "$ITER_PATH" '
        .value[] | (.fields["System.Tags"] // "") as $tags
        | select([ $tags | split(";") | .[] | gsub("^ +| +$";"") ] | index($tag))
        | "\(.id)\t\(.fields["System.IterationPath"])\t\(if .fields["System.IterationPath"]==$iter then "this" else "other" end)\t\(.fields["System.Title"])"' \
      >> /tmp/rcs_releases.tsv
  done
fi

# 3) join ticket->release with the area label and the tagged-release classification
awk -F'\t' -v LBL=/tmp/rcs_labeled.tsv -v REL=/tmp/rcs_releases.tsv '
BEGIN{
  while((getline l < LBL)>0){ split(l,a,"\t"); area[a[2]]=a[1] }
  while((getline r < REL)>0){ split(r,b,"\t"); rc[b[1]]=b[3]; ri[b[1]]=b[2]; rt[b[1]]=b[4] }
}
{ t=$1; rid=$2; if(rid in rc) print area[t]"\t"t"\t"rid"\t"ri[rid]"\t"rc[rid]"\t"rt[rid] }
' /tmp/rcs_succ.tsv | sort > /tmp/rcs_links.tsv

TOTAL_LINKS=$(grep -c . /tmp/rcs_links.tsv); THIS_LINKS=$(awk -F'\t' '$5=="this"' /tmp/rcs_links.tsv | grep -c .); OTHER_LINKS=$(awk -F'\t' '$5=="other"' /tmp/rcs_links.tsv | grep -c .)
echo "existing auro-rcs links found: $TOTAL_LINKS  (this-sprint: $THIS_LINKS, other-sprint: $OTHER_LINKS)"
[ "$TOTAL_LINKS" -gt 0 ] && { echo "  area / ticket / release / iter / class / title"; cat /tmp/rcs_links.tsv; }
```

**Decide reconciliation.** First create the three decision files empty (so 3B/3D work even with nothing to reconcile):
```bash
: > /tmp/rcs_reuse.tsv   # area <TAB> existingReleaseId            (Scenario B "yes")
: > /tmp/rcs_moves.tsv   # ticketId <TAB> oldReleaseId <TAB> area  (Scenario A "yes")
: > /tmp/rcs_left.tsv    # ticketId <TAB> oldReleaseId <TAB> releaseIter <TAB> area  (Scenario A "no")
```
If the scan found no links, skip the prompts — the files stay empty. Otherwise, using `/tmp/rcs_links.tsv`:
- **Scenario B — an area has a `this`-class link:** for each such area ask once: *"Some tickets in `<area>` are already linked to this-sprint Release ticket #`<id>` (`<title>`). Link ALL of `<area>`'s tickets to that ticket instead of creating a new Release ticket?"* On **yes**, append `<area>⇥<id>` to `/tmp/rcs_reuse.tsv`. On **no**, do nothing (a new ticket is created; the pre-existing link is left, which may be an intentional dual-link).
- **Scenario A — a ticket has an `other`-class link:** for **each** such ticket ask: *"Ticket #`<ticketId>` is linked to Release #`<releaseId>` in `<releaseIter>` (not this sprint). Remove that link and link it to this sprint's `<area>` Release ticket instead?"* On **yes**, append `<ticketId>⇥<releaseId>⇥<area>` to `/tmp/rcs_moves.tsv`. On **no**, append `<ticketId>⇥<releaseId>⇥<releaseIter>⇥<area>` to `/tmp/rcs_left.tsv`.

(Append with a literal tab, e.g. `printf '%s\t%s\n' "$AREA" "$RID" >> /tmp/rcs_reuse.tsv`.)

### 3B — Present the planned change set

Run this block to print exactly what the submit step would do (still no writes), then show it to the user:
```bash
ITER_NAME="<ITER_NAME>"; FINISH="<FINISH>"   # from Step 1 (re-declared: fresh shell per block)
TARGET_DATE="${FINISH}T00:00:00Z"; RCS_TAG="auro-rcs"
AREAS=$(cut -f1 /tmp/rcs_labeled.tsv | sort -u)
echo "=================  PLANNED CHANGES  ================="
echo; echo "Reuse existing this-sprint Release tickets (no new ticket created):"
if [ -s /tmp/rcs_reuse.tsv ]; then
  while IFS=$'\t' read -r A RID; do [ -z "$A" ] && continue
    printf '  %s  ->  Release #%s   (add Predecessor links for this area'"'"'s tickets)\n' "$A" "$RID"
  done < /tmp/rcs_reuse.tsv
else echo "  (none)"; fi

echo; echo "Create new Release tickets:"
REUSE_AREAS=$(cut -f1 /tmp/rcs_reuse.tsv | sort -u)
while IFS= read -r AREA; do [ -z "$AREA" ] && continue
  printf '%s\n' "$REUSE_AREAS" | grep -qxF "$AREA" && continue
  SAFE=$(printf '%s' "$AREA" | tr '\\/ ' '___')
  PC=$(jq '[.[]|select(.path=="/relations/-")]|length' "/tmp/rcs_draft_${SAFE}_parent.json")
  printf '  Release %s - %s   [User Story, Blocked, Target %s, tag %s]  Predecessors: %s  (+ Generate Release Notes, + Update Dependencies)\n' \
    "$AREA" "$ITER_NAME" "$TARGET_DATE" "$RCS_TAG" "$PC"
done <<< "$AREAS"

echo; echo "Move links to this sprint (remove old out-of-sprint link):"
if [ -s /tmp/rcs_moves.tsv ]; then awk -F'\t' '{printf "  ticket #%s : unlink Release #%s, keep this-sprint %s Release\n",$1,$2,$3}' /tmp/rcs_moves.tsv
else echo "  (none)"; fi

echo; echo "Left linked to out-of-sprint Release tickets (unchanged):"
if [ -s /tmp/rcs_left.tsv ]; then awk -F'\t' '{printf "  ticket #%s : stays linked to Release #%s (%s)\n",$1,$2,$3}' /tmp/rcs_left.tsv
else echo "  none fall into this group"; fi
echo "===================================================="
```

### 3C — Confirm gate

Show the 3B summary and ask the user in plain words: **"Submit these changes to Azure DevOps? (yes/no)"** — this creates the Release work items and applies the link changes above. If the user says anything other than an explicit **yes**, stop: write nothing and tell them the plan was discarded (then run 3E to print the "left linked" list). Only on an explicit **yes** run 3D.

### 3D — Apply the changes (only after an explicit "yes")

This is the **only** phase that writes to ADO. Run this block; it creates tickets, wires up children, adds predecessor links, and removes moved links, recording results to `/tmp/rcs_applied.tsv` and failures to `/tmp/rcs_apply_fail.tsv`:
```bash
ITER_NAME="<ITER_NAME>"   # from Step 1 (re-declared: fresh shell per block)
AREAS=$(cut -f1 /tmp/rcs_labeled.tsv | sort -u)
BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
ORG_WI="https://itsals.visualstudio.com/_apis/wit/workItems"
: > /tmp/rcs_applied.tsv; : > /tmp/rcs_apply_fail.tsv

post_wi(){ # $1=url-encoded type  $2=payload-file  -> echoes new id (empty on failure; logs it)
  local resp code body
  resp=$(curl -sS -u ":$ADO_PAT" -w $'\n%{http_code}' -X POST \
    -H "Content-Type: application/json-patch+json" --data-binary @"$2" \
    "$BASE/workitems/\$$1?api-version=7.1")   # 7.1 required: multilineFieldsFormat (Markdown) is ignored on 7.0
  code=$(printf '%s' "$resp" | sed -n '$p'); body=$(printf '%s' "$resp" | sed '$d')
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then printf '%s' "$body" | jq -r '.id'
  else printf 'CREATE %s FAILED http=%s\t%s\n' "$1" "$code" "$(printf '%s' "$body" | tr '\n' ' ' | cut -c1-200)" >> /tmp/rcs_apply_fail.tsv; fi
}

REUSE_AREAS=$(cut -f1 /tmp/rcs_reuse.tsv | sort -u)
while IFS= read -r AREA; do [ -z "$AREA" ] && continue
  SAFE=$(printf '%s' "$AREA" | tr '\\/ ' '___')

  if printf '%s\n' "$REUSE_AREAS" | grep -qxF "$AREA"; then
    # reuse existing this-sprint ticket: add Predecessor links for area tickets not already linked to it
    RELID=$(awk -F'\t' -v a="$AREA" '$1==a{print $2; exit}' /tmp/rcs_reuse.tsv)
    for TID in $(awk -F'\t' -v a="$AREA" '$1==a{print $2}' /tmp/rcs_labeled.tsv); do
      awk -F'\t' -v a="$AREA" -v t="$TID" -v r="$RELID" '$1==a&&$2==t&&$3==r{f=1}END{exit f?0:1}' /tmp/rcs_links.tsv && continue
      OP=$(jq -cn --arg url "$ORG_WI/$TID" '[{op:"add",path:"/relations/-",value:{rel:"System.LinkTypes.Dependency-Reverse",url:$url,attributes:{comment:"RC predecessor"}}}]')
      code=$(curl -sS -u ":$ADO_PAT" -o /dev/null -w "%{http_code}" -X PATCH \
        -H "Content-Type: application/json-patch+json" --data-binary "$OP" "$BASE/workitems/$RELID?api-version=7.0")
      [ "$code" = "200" ] && printf 'LINK\t%s\t->\t%s\n' "$TID" "$RELID" >> /tmp/rcs_applied.tsv \
        || printf 'LINK ADD FAILED http=%s ticket=%s release=%s\n' "$code" "$TID" "$RELID" >> /tmp/rcs_apply_fail.tsv
    done
  else
    # create the new parent story (payload already has fields + tag + predecessor links)
    RELID=$(post_wi "User%20Story" "/tmp/rcs_draft_${SAFE}_parent.json")
    if [ -n "$RELID" ]; then
      printf 'CREATE\tUser Story\t%s\tRelease %s - %s\n' "$RELID" "$AREA" "$ITER_NAME" >> /tmp/rcs_applied.tsv
      for kind in notes deps; do
        jq --arg url "$ORG_WI/$RELID" '. + [{op:"add",path:"/relations/-",value:{rel:"System.LinkTypes.Hierarchy-Reverse",url:$url}}]' \
           "/tmp/rcs_draft_${SAFE}_child_${kind}.json" > /tmp/rcs_apply_child.json
        CID=$(post_wi "Task" /tmp/rcs_apply_child.json)
        [ -n "$CID" ] && printf 'CREATE\tTask\t%s\t(child of %s)\n' "$CID" "$RELID" >> /tmp/rcs_applied.tsv
      done
    fi
  fi

  # Scenario A moves for this area: remove each ticket's old Successor link (the ticket is already a
  # Predecessor of RELID via the create/reuse above, so only the stale link needs removing).
  awk -F'\t' -v a="$AREA" '$3==a{print $1"\t"$2}' /tmp/rcs_moves.tsv | while IFS=$'\t' read -r TID OLD; do
    [ -z "$TID" ] && continue
    WI=$(curl -sS -u ":$ADO_PAT" "$BASE/workItems/$TID?\$expand=relations&api-version=7.0")
    REV=$(printf '%s' "$WI" | jq -r '.rev')
    IDX=$(printf '%s' "$WI" | jq -r --arg oid "$OLD" '[.relations[]?]|to_entries|map(select(.value.rel=="System.LinkTypes.Dependency-Forward" and (.value.url|endswith("/"+$oid))))|.[0].key // empty')
    if [ -n "$IDX" ]; then
      code=$(curl -sS -u ":$ADO_PAT" -o /dev/null -w "%{http_code}" -X PATCH -H "Content-Type: application/json-patch+json" \
        --data-binary "[{\"op\":\"test\",\"path\":\"/rev\",\"value\":$REV},{\"op\":\"remove\",\"path\":\"/relations/$IDX\"}]" \
        "$BASE/workitems/$TID?api-version=7.0")
      [ "$code" = "200" ] && printf 'UNLINK\t%s\tfrom\t%s\n' "$TID" "$OLD" >> /tmp/rcs_applied.tsv \
        || printf 'UNLINK FAILED http=%s ticket=%s release=%s\n' "$code" "$TID" "$OLD" >> /tmp/rcs_apply_fail.tsv
    fi
  done
done <<< "$AREAS"

echo "apply complete. successes: $(grep -c . /tmp/rcs_applied.tsv), failures: $(grep -c . /tmp/rcs_apply_fail.tsv)"
```

### 3E — Report what changed

Run after 3D (or straight after a "no" at 3C, when nothing was applied):
```bash
echo "==================  SUMMARY  =================="
if [ -s /tmp/rcs_applied.tsv ]; then
  echo "Applied to Azure DevOps:"
  awk -F'\t' '
    $1=="CREATE"{printf "  created %s #%s  %s\n",$2,$3,$4}
    $1=="LINK"  {printf "  linked ticket #%s -> Release #%s\n",$2,$4}
    $1=="UNLINK"{printf "  unlinked ticket #%s from Release #%s\n",$2,$4}' /tmp/rcs_applied.tsv
else echo "No changes were submitted."; fi
[ -s /tmp/rcs_apply_fail.tsv ] && { echo; echo "Failures (review and re-run):"; cat /tmp/rcs_apply_fail.tsv; }
echo; echo "Tickets left linked to Release tickets NOT in this sprint:"
if [ -s /tmp/rcs_left.tsv ]; then awk -F'\t' '{printf "  ticket #%s -> Release #%s (%s)\n",$1,$2,$3}' /tmp/rcs_left.tsv
else echo "  none fall into this group"; fi
echo "=============================================="
```

Then summarize to the user in prose: how many Release tickets were created (with ids) or reused, which links were added/removed, and the list of tickets left linked to out-of-sprint Release tickets (or that none were). If the user declined at 3C, say plainly that nothing was written.
