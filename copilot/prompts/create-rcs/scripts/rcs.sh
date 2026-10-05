#!/usr/bin/env bash
# rcs.sh — the Azure DevOps / GitHub / npm calls behind the create-rcs skill.
#
# The skill runs every step as ONE plain command, `rcs.sh <command> [args]`, so the single
# `allowed-tools` rule in SKILL.md approves it. A compound shell command (variable assignments,
# `$(...)`, redirects, pipes) can't match an allow rule, so in auto mode it falls through to the
# classifier, which blocks a credential being sent to a host it doesn't know. Keep all shell logic
# in here, not in the skill body.
#
# Each command runs in a fresh process, so state passes between steps through /tmp/rcs_* files:
#   /tmp/rcs_repo.tsv   repo-mode marker (absent = sprint mode): package, GitHub repo, ADO area, published
#   /tmp/rcs_iter.tsv   chosen iteration: name, Iteration Path, start, finish
#
# Commands, in skill order:
#   mode [<npm package>]                  Step 0  — sprint mode (no argument), or resolve repo mode
#   repo-area <area>                      Step 0  — set the ADO area after `mode` printed NO_MATCH
#   iterations                            Step 1  — list the sprints
#   iter-select <reply>                   Step 1  — resolve the user's pick (number, name, or `current`)
#   gather                                Step 2 (sprint mode) / Step 2R (repo mode)
#   plan [<state>]                        Step 3A — validate the parent State, build the draft payloads
#   scan-links                            Step 3A — find existing auro-rcs links, reset the decision files
#   decide reuse <area> <releaseId>       Step 3A — Scenario B "yes"
#   decide move <ticketId> <releaseId>    Step 3A — Scenario A "yes"
#   decide leave <ticketId> <releaseId>   Step 3A — Scenario A "no"
#   docs-reuse                            Step 3A — reuse an existing this-sprint AuroDocsSite Release ticket
#   preview                               Step 3B — print the planned change set
#   apply                                 Step 3D — the ONLY command that writes to Azure DevOps
#   summary                               Step 3E — report what changed
#
# Auth: every ADO call uses the PAT in $ADO_PAT (HTTP Basic, empty username). The token is never printed.
# Written for macOS's bash 3.2: no associative arrays, no ${var,,}, no mapfile.

BASE="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
ORG_WI="https://itsals.visualstudio.com/_apis/wit/workItems"   # work-item URL stem for relation links
PFX='E_Retain_Content\Auro Design System'
RCS_TAG="auro-rcs"   # tag stamped on every Release ticket this skill creates
DOCS="AuroDocsSite"

die(){ printf '%s\n' "$*"; exit 1; }

need_pat(){
  [ -n "$ADO_PAT" ] || die "ADO_PAT_MISSING — no Azure DevOps token in the environment."
}

# ADO answers a missing/expired/under-scoped PAT with its sign-in page (HTTP 203) or a 302/401,
# never an empty result — so anything but 200 is an auth failure, not "no work items".
need_200(){ # $1=label  $2=http code
  [ "$2" = "200" ] || die "ADO_AUTH_FAILURE — $1 returned HTTP $2 (PAT missing, expired, or lacking scope)."
}

trim(){ printf '%s' "$*" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }

load_iter(){
  [ -s /tmp/rcs_iter.tsv ] || die "NO_ITERATION — run \`rcs.sh iter-select\` first."
  IFS=$'\t' read -r ITER_NAME ITER_PATH START FINISH < /tmp/rcs_iter.tsv
}

load_repo(){ # PKG GH_REPO REPO_AREA PUBLISHED — all empty in sprint mode
  PKG=""; GH_REPO=""; REPO_AREA=""; PUBLISHED=""
  if [ -s /tmp/rcs_repo.tsv ]; then IFS=$'\t' read -r PKG GH_REPO REPO_AREA PUBLISHED < /tmp/rcs_repo.tsv; fi
}

list_areas(){
  jq -r '.children[]? | select(.name=="Auro Design System") | .children[]?.name' /tmp/rcs_areas_tree.json | sort -f
}

write_repo_marker(){
  printf '%s\t%s\t%s\t%s\n' "$PKG" "$GH_REPO" "$REPO_AREA" "$PUBLISHED" > /tmp/rcs_repo.tsv
  echo "ADO area: $REPO_AREA"
  echo "REPO_MODE_OK"
}

# ---------------------------------------------------------------------------------------------
# Step 0 — mode
# ---------------------------------------------------------------------------------------------

cmd_mode(){
  # Clear every marker from an earlier run so a stale repo/iteration can't leak in.
  rm -f /tmp/rcs_repo.tsv /tmp/rcs_repo_pending.tsv /tmp/rcs_iter.tsv
  REPO_ARG=$(trim "$*")
  if [ -z "$REPO_ARG" ]; then echo "SPRINT_MODE"; return; fi

  gh auth status >/dev/null 2>&1 || die "GH_AUTH_MISSING"
  need_pat

  case "$REPO_ARG" in
    @*/*) PKG="$REPO_ARG" ;;
    *)    PKG="@aurodesignsystem/$REPO_ARG" ;;
  esac

  # npm registry -> GitHub owner/repo. `.repository` is an object or a bare string; an unpublished
  # package returns {"error":"Not found"}, which leaves PUBLISHED=no (no dependency-checklist entry later).
  REG=$(curl -sS "https://registry.npmjs.org/$PKG")
  PUBLISHED=$(printf '%s' "$REG" | jq -r 'if .name then "yes" else "no" end' 2>/dev/null)
  [ -n "$PUBLISHED" ] || PUBLISHED="no"
  GH_REPO=$(printf '%s' "$REG" | jq -r '(.repository | if type=="object" then .url else . end) // empty' 2>/dev/null \
    | grep -oE 'github\.com[:/][^/]+/[^/#]+' | sed -E 's#^github\.com[:/]##; s#\.git$##')
  [ -z "$GH_REPO" ] && GH_REPO="AlaskaAirlines/${PKG##*/}"

  # Confirm the repo (canonical owner/name casing) and both branches exist.
  GH_REPO=$(gh api "repos/$GH_REPO" --jq .full_name 2>/dev/null) || GH_REPO=""
  echo "package: $PKG  (published on npm: $PUBLISHED)   repo: ${GH_REPO:-NOT_FOUND}"
  [ -n "$GH_REPO" ] || die "REPO_NOT_FOUND"
  MISSING=""
  for B in dev main; do
    if gh api "repos/$GH_REPO/branches/$B" --jq .name >/dev/null 2>&1; then echo "branch $B: ok"
    else echo "branch $B: MISSING"; MISSING=1; fi
  done
  [ -z "$MISSING" ] || die "BRANCH_MISSING"

  # ADO area: a direct child of "Auro Design System" matching the repo name, else the package base name.
  HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_areas_tree.json -w "%{http_code}" \
    "$BASE/classificationnodes/Areas?\$depth=2&api-version=7.0")
  need_200 "areas" "$HTTP"
  REPO_AREA=$(jq -r --arg a "${GH_REPO#*/}" --arg b "${PKG##*/}" '
    [ .children[]? | select(.name=="Auro Design System") | .children[]?.name ] as $areas
    | first( ($a, $b) as $q | $areas[] | select(ascii_downcase == ($q | ascii_downcase)) ) // empty' /tmp/rcs_areas_tree.json)
  if [ -z "$REPO_AREA" ]; then
    printf '%s\t%s\t%s\n' "$PKG" "$GH_REPO" "$PUBLISHED" > /tmp/rcs_repo_pending.tsv
    echo "ADO area: NO_MATCH — areas under Auro Design System:"
    list_areas
    return
  fi
  write_repo_marker
}

cmd_repo_area(){
  [ -s /tmp/rcs_repo_pending.tsv ] || die "NO_PENDING_REPO — run \`rcs.sh mode <package>\` first."
  IFS=$'\t' read -r PKG GH_REPO PUBLISHED < /tmp/rcs_repo_pending.tsv
  # Match case-insensitively but keep the area's canonical casing (ENVIRON, not -v, so nothing is unescaped).
  REPO_AREA=$(list_areas | Q="$(trim "$*")" awk 'BEGIN{ q=tolower(ENVIRON["Q"]) } tolower($0)==q{ print; exit }')
  if [ -z "$REPO_AREA" ]; then echo "NO_SUCH_AREA: $* — pick one of:"; list_areas; exit 1; fi
  rm -f /tmp/rcs_repo_pending.tsv
  write_repo_marker
}

# ---------------------------------------------------------------------------------------------
# Step 1 — iteration
# ---------------------------------------------------------------------------------------------

cmd_iterations(){
  need_pat
  HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_iters.json -w "%{http_code}" \
    "$BASE/classificationnodes/Iterations?\$depth=10&api-version=7.0")
  need_200 "iterations" "$HTTP"
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
    to_entries[]
    | "\(.key+1)) \(.value.name)   [\(.value.start) → \(.value.finish)]"
      + (if (.value.start <= $today and $today <= .value.finish) then "   ← current" else "" end)
  ' /tmp/rcs_iter_list.json
}

cmd_iter_select(){
  [ -s /tmp/rcs_iter_list.json ] || die "NO_ITERATION_LIST — run \`rcs.sh iterations\` first."
  SEL=$(trim "$*")
  TODAY=$(date -u +%Y-%m-%d)
  ROW='"\(.name)\t\(.start)\t\(.finish)\t\(.path)"'
  case "$(printf '%s' "$SEL" | tr '[:upper:]' '[:lower:]')" in
    ""|current)
      HIT=$(jq -r --arg today "$TODAY" "[ .[] | select(.start <= \$today and \$today <= .finish) ] | .[0] // empty | $ROW" /tmp/rcs_iter_list.json)
      [ -n "$HIT" ] || die "NO_CURRENT — today ($TODAY) falls in no listed iteration." ;;
    *[!0-9]*)
      # A name (or partial name), matched case-insensitively against the full set, archive included.
      HIT=$(jq -r --arg q "$SEL" "[ .[] | select(.name | ascii_downcase | contains(\$q | ascii_downcase)) ]
        | if length==0 then \"NO_MATCH\"
          elif length==1 then (.[0] | $ROW)
          else \"MULTI: \" + ([ .[].name ] | join(\" | \")) end" /tmp/rcs_iter_all.json)
      case "$HIT" in NO_MATCH|MULTI:*) die "$HIT" ;; esac ;;
    *)
      N=$((10#$SEL))
      HIT=$(jq -r --argjson n "$N" "if \$n >= 1 and \$n <= length then (.[\$n-1] | $ROW) else empty end" /tmp/rcs_iter_list.json)
      [ -n "$HIT" ] || die "OUT_OF_RANGE — $SEL is not a number on the list." ;;
  esac

  # Iteration names contain spaces, so the row is tab-separated — never whitespace-split it.
  IFS=$'\t' read -r ITER_NAME START FINISH NODE_PATH <<< "$HIT"
  # The node path (\E_Retain_Content\Iteration\<name>) -> the queryable Iteration Path
  # (E_Retain_Content\<name>): drop the leading backslash and the `Iteration` classification segment.
  ITER_PATH=$(printf '%s' "$NODE_PATH" | sed -e 's#^\\##' -e 's#\\Iteration\\#\\#')
  printf '%s\t%s\t%s\t%s\n' "$ITER_NAME" "$ITER_PATH" "$START" "$FINISH" > /tmp/rcs_iter.tsv
  printf 'ITERATION: %s\nDATES: %s → %s\nITER_PATH: %s\n' "$ITER_NAME" "$START" "$FINISH" "$ITER_PATH"
}

# ---------------------------------------------------------------------------------------------
# Step 2 / 2R — gather
# ---------------------------------------------------------------------------------------------

cmd_gather(){
  need_pat
  if [ -s /tmp/rcs_repo.tsv ]; then gather_repo; else gather_sprint; fi
}

gather_sprint(){
  load_iter

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
  need_200 "work item query" "$HTTP"

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
}

gather_repo(){
  load_repo
  AREA_PATH="$PFX\\$REPO_AREA"
  EXCL='["Test Case","Test Plan","Test Suite","Epic","Feature","Initiative","Design Story","Task"]'

  # 1. Commits on dev not on main (paged). Each commit is emitted as an "@@COMMIT <sha>" marker line
  #    followed by its full message, so AB# refs in bodies are caught and attributed to a short sha.
  gh api --paginate "repos/$GH_REPO/compare/main...dev?per_page=100" \
    --jq '.commits[] | "@@COMMIT \(.sha)\n\(.commit.message)"' > /tmp/rcs_repo_msgs.txt
  AHEAD=$(gh api "repos/$GH_REPO/compare/main...dev?per_page=1" --jq .ahead_by)
  NCOMMITS=$(grep -c '^@@COMMIT ' /tmp/rcs_repo_msgs.txt)
  echo "commits on dev not on main: $NCOMMITS fetched (GitHub reports $AHEAD ahead)"

  # "<id>\t<sha7>" per reference, plus the subjects of commits that reference no ticket at all.
  awk '/^@@COMMIT /{sha=substr($2,1,7); next}
       { s=$0; while (match(s, /AB#[0-9]+/)) { print substr(s, RSTART+3, RLENGTH-3) "\t" sha; s=substr(s, RSTART+RLENGTH) } }' \
    /tmp/rcs_repo_msgs.txt | sort -u > /tmp/rcs_repo_commit_refs.tsv
  awk '/^@@COMMIT /{ if (sha!="" && !ref) print sha "  " subj; sha=substr($2,1,7); subj=""; ref=0; next }
       subj=="" { subj=$0 }  /AB#[0-9]+/ { ref=1 }
       END{ if (sha!="" && !ref) print sha "  " subj }' /tmp/rcs_repo_msgs.txt > /tmp/rcs_repo_unref.txt
  cut -f1 /tmp/rcs_repo_commit_refs.tsv | sort -un > /tmp/rcs_repo_commit_ids.txt
  echo "tickets referenced by those commits: $(grep -c . /tmp/rcs_repo_commit_ids.txt)   commits with no AB# reference: $(grep -c . /tmp/rcs_repo_unref.txt)"

  # 2. In-flight tickets under the repo's area, any iteration.
  ESC_AREA=$(printf '%s' "$AREA_PATH" | sed "s/'/''/g")
  QUERY="SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '$ESC_AREA' AND [System.WorkItemType] NOT IN ('Test Case','Test Plan','Test Suite','Epic','Feature','Initiative','Design Story','Task') AND [System.State] IN ('Committed','Blocked','Active','Ready For Acceptance') AND [System.Tags] NOT CONTAINS 'auro-rcs' ORDER BY [System.Id]"
  BODY=$(jq -cn --arg q "$QUERY" '{query:$q}')
  HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_wiql.json -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" --data-binary "$BODY" "$BASE/wiql?api-version=7.0")
  need_200 "in-flight query" "$HTTP"
  jq -r '.workItems[].id' /tmp/rcs_wiql.json | sort -un > /tmp/rcs_repo_inflight_ids.txt
  echo "in-flight tickets in $REPO_AREA: $(grep -c . /tmp/rcs_repo_inflight_ids.txt)"

  # 3. Union, with where each id came from -> "<id>\t<commit|in-flight|commit+in-flight>"
  sort -un /tmp/rcs_repo_commit_ids.txt /tmp/rcs_repo_inflight_ids.txt | awk '
    BEGIN{ while ((getline l < "/tmp/rcs_repo_commit_ids.txt") > 0) c[l]=1
           while ((getline l < "/tmp/rcs_repo_inflight_ids.txt") > 0) f[l]=1 }
    NF{ print $1 "\t" ((c[$1] && f[$1]) ? "commit+in-flight" : (c[$1] ? "commit" : "in-flight")) }' > /tmp/rcs_repo_src.tsv

  # 4. Batch-fetch every id (errorPolicy=omit: a deleted/inaccessible id comes back null instead of failing
  #    the whole batch) -> "<verdict>\t<id>\t<type>\t<state>\t<who>\t<area>\t<title>", verdict KEEP or SKIP:<why>.
  : > /tmp/rcs_repo_fetched.tsv
  IDS_JSON=$(cut -f1 /tmp/rcs_repo_src.tsv | jq -R 'select(length>0)|tonumber' | jq -sc '.')
  TOTAL=$(jq 'length' <<<"$IDS_JSON")
  for S in $(seq 0 200 $((TOTAL>0 ? TOTAL-1 : 0))); do
    [ "$TOTAL" -eq 0 ] && break
    CHUNK=$(jq -c --argjson s "$S" '{ids: .[$s:$s+200], errorPolicy:"omit", fields:["System.WorkItemType","System.State","System.AssignedTo","System.AreaPath","System.Title","System.Tags"]}' <<<"$IDS_JSON")
    curl -sS -u ":$ADO_PAT" -X POST -H "Content-Type: application/json" --data-binary "$CHUNK" \
      "$BASE/workitemsbatch?api-version=7.0" \
    | jq -r --argjson ex "$EXCL" '.value[] | select(. != null)
        | .fields as $f | $f["System.WorkItemType"] as $t
        | ([ ($f["System.Tags"] // "") | split(";")[] | gsub("^ +| +$";"") ] | index("auro-rcs")) as $rcs
        | (if $rcs != null then "SKIP:tagged auro-rcs" elif ($ex | index($t)) != null then "SKIP:excluded type" else "KEEP" end) as $v
        | "\($v)\t\(.id)\t\($t)\t\($f["System.State"])\t\($f["System.AssignedTo"].displayName // "Unassigned")\t\($f["System.AreaPath"])\t\(($f["System.Title"] // "") | gsub("[\t\n\r]"; " "))"' \
      >> /tmp/rcs_repo_fetched.tsv
  done
  cut -f2 /tmp/rcs_repo_fetched.tsv | sort -un > /tmp/rcs_repo_found_ids.txt

  # 5. Kept rows -> rcs_rows.tsv with the area forced to the repo's area (via ENVIRON: awk -v would mangle the
  #    backslashes). The display copy keeps the real area and adds the source column.
  RA="$AREA_PATH" awk -F'\t' 'BEGIN{ ra=ENVIRON["RA"] } $1=="KEEP"{ print $2"\t"$3"\t"$4"\t"$5"\t"ra"\t"$7 }' \
    /tmp/rcs_repo_fetched.tsv > /tmp/rcs_rows.tsv
  awk -F'\t' 'BEGIN{ while ((getline l < "/tmp/rcs_repo_src.tsv") > 0) { split(l, a, "\t"); src[a[1]]=a[2] } }
    $1=="KEEP"{ print $2"\t"src[$2]"\t"$3"\t"$4"\t"$5"\t"$6"\t"$7 }' /tmp/rcs_repo_fetched.tsv | sort -n > /tmp/rcs_repo_view.tsv

  # 6. Skipped: excluded/tagged tickets, plus commit-referenced ids that came back missing.
  awk -F'\t' '$1!="KEEP"{ sub(/^SKIP:/, "", $1); print $2"\t"$1"\t"$3"\t"$7 }' /tmp/rcs_repo_fetched.tsv > /tmp/rcs_repo_skipped.tsv
  grep -vxF -f /tmp/rcs_repo_found_ids.txt /tmp/rcs_repo_commit_ids.txt | awk 'NF{ print $1"\tnot found or no access\t\t" }' >> /tmp/rcs_repo_skipped.tsv

  echo "tickets to release: $(grep -c . /tmp/rcs_rows.tsv)   skipped: $(grep -c . /tmp/rcs_repo_skipped.tsv)"
  echo "--- id / source / type / state / assigned / real area / title ---"; cat /tmp/rcs_repo_view.tsv
  echo "--- commit references (id / sha) ---"; cat /tmp/rcs_repo_commit_refs.tsv
  echo "--- skipped (id / reason / type / title) ---"; cat /tmp/rcs_repo_skipped.tsv
  echo "--- commits with no AB# reference ---"; cat /tmp/rcs_repo_unref.txt
}

# ---------------------------------------------------------------------------------------------
# Step 3A — plan (read-only)
# ---------------------------------------------------------------------------------------------

cmd_plan(){
  load_iter; load_repo; need_pat
  [ -f /tmp/rcs_rows.tsv ] || die "NO_ROWS — run \`rcs.sh gather\` first."
  STATE="${1:-Blocked}"
  TARGET_DATE="${FINISH}T00:00:00Z"   # Release story Target Date = last day of the iteration

  # Validate the parent State against the User Story workflow before drafting anything.
  HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_us_states.json -w "%{http_code}" \
    "$BASE/workItemTypes/User%20Story/states?api-version=7.0")
  need_200 "User Story states" "$HTTP"
  jq -r '.value[]?.name' /tmp/rcs_us_states.json > /tmp/rcs_us_states.txt
  if ! grep -qxF "$STATE" /tmp/rcs_us_states.txt; then
    echo "STATE_INVALID: \"$STATE\" is not a User Story state. Valid states:"; cat /tmp/rcs_us_states.txt; exit 1
  fi
  echo "STATE_OK: $STATE"

  rm -f /tmp/rcs_draft_*.json   # clear any prior drafts

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

  # Canonical area set (/tmp/rcs_areas.txt): the areas with sprint tickets, PLUS a forced "AuroDocsSite"
  # whenever any OTHER area is releasing this sprint — the docs site depends on every component, so it
  # always gets a Release ticket (even with zero AuroDocsSite tickets of its own, i.e. no area predecessors).
  # labeled.tsv is left untouched (ticket-only), so predecessor lists and the link scan are unaffected.
  cut -f1 /tmp/rcs_labeled.tsv | sort -u > /tmp/rcs_areas.txt
  if grep -qvxF "$DOCS" /tmp/rcs_areas.txt; then          # a non-AuroDocsSite area exists
    grep -qxF "$DOCS" /tmp/rcs_areas.txt || echo "$DOCS" >> /tmp/rcs_areas.txt
    sort -u -o /tmp/rcs_areas.txt /tmp/rcs_areas.txt
  fi
  OTHER_AREAS=$(grep -vxF "$DOCS" /tmp/rcs_areas.txt)      # every non-docs release this sprint (for the dep list)

  # Map each other area to its published NPM package for the AuroDocsSite dependency checklist.
  # Default is @aurodesignsystem/<area>; the `map[...]` overrides handle areas whose package name or
  # scope differs from the area label. `nopkg[...]` lists areas that have NO published npm package
  # (spikes/tooling the docs site doesn't depend on) — they still get a Release ticket and a
  # cross-release Predecessor link, but are omitted from the dependency checkbox list. Add a line to
  # `map` for a naming exception, or to `nopkg` for a non-published area.
  # The resulting package list is written once to /tmp/rcs_dep_pkgs.txt and reused wherever the dep
  # checklist is rendered (the AC draft, the readable draft, and the 3B change-set preview).
  # Repo mode: the only other release is the repo itself, and its real package name is already known.
  if [ -n "$REPO_AREA" ]; then
    if [ -n "$OTHER_AREAS" ] && [ "$PUBLISHED" = "yes" ]; then printf '%s\n' "$PKG"; fi > /tmp/rcs_dep_pkgs.txt
  else
    printf '%s\n' "$OTHER_AREAS" | awk '
      BEGIN{
        map["WebCoreStyleSheets"]="@aurodesignsystem/webcorestylesheets"
        map["icons"]="@alaskaairux/icons"
        nopkg["auro-ai"]=1
      }
      NF && !($0 in nopkg){ print ( ($0 in map) ? map[$0] : "@aurodesignsystem/" $0 ) }' > /tmp/rcs_dep_pkgs.txt
  fi

  AREAS=$(cat /tmp/rcs_areas.txt)
  echo "Planning Release work items for $(printf '%s\n' "$AREAS" | grep -c .) areas (nothing written to ADO yet)."
  echo

  while IFS= read -r AREA; do
    [ -z "$AREA" ] && continue
    SAFE=$(printf '%s' "$AREA" | tr '\\/ ' '___')
    AREA_PATH="$PFX\\$AREA"
    TITLE="Release $AREA - $ITER_NAME"

    # predecessor ids for this area
    IDS=$(awk -F'\t' -v a="$AREA" '$1==a{print $2}' /tmp/rcs_labeled.tsv)

    PRED_LINE="Every work item completed for \`$AREA\` this iteration is linked as a **Predecessor** of this item — those are the changes bundled into this release."
    if [ -n "$REPO_AREA" ] && [ "$AREA" = "$REPO_AREA" ]; then
      PRED_LINE="Every work item referenced (\`AB#<id>\`) by a commit on \`$GH_REPO\`'s \`dev\` branch that is not yet on \`main\`, plus every \`$AREA\` work item currently Committed, Blocked, Active, or Ready For Acceptance, is linked as a **Predecessor** of this item — those are the changes bundled into this release."
    fi

    DESC="**Release coordination for \`$AREA\` — $ITER_NAME.**

This work item manages the release flow for the \`$AREA\` area of the Auro Design System. It is the single gate for cutting and shipping the \`$AREA\` release candidate (RC) this iteration.

- $PRED_LINE
- This item stays **$STATE** until all predecessor work is complete.
- Its child tasks prepare the release: **Generate Release Notes** produces the release-notes document that ships with the release, and **Update Dependencies** reviews and updates the NPM dependencies for the area.

Use this ticket as the go/no-go checkpoint for the \`$AREA\` release."

    AC="- [ ] **The release candidate has been re-tested** — the \`$AREA\` RC has been re-tested and verified to pass after all predecessor work merged.
- [ ] **The release has been cut** — once all predecessor work items are closed and test validation is complete and passing, the release-candidate PR is merged into the \`main\` branch."

    # AuroDocsSite only: prefix the AC with a dependency-update checklist (one package per other release
    # this sprint) and note the cross-release gating in the description. The docs site bumps each
    # released component's package to the version cut this iteration.
    if [ "$AREA" = "$DOCS" ] && [ -n "$OTHER_AREAS" ]; then
      DEP_ITEMS=$(awk 'NF{printf "  - [ ] `%s`\n", $0}' /tmp/rcs_dep_pkgs.txt)   # mapped package names
      AC="- [ ] **Dependency updates implemented** — bump AuroDocsSite's dependencies to the versions released this sprint, aligning the docs site with every other Auro release cut this iteration:
${DEP_ITEMS}
${AC}"
      DESC="$DESC

Because the docs site depends on every Auro component, this release also gates on each of this sprint's other \`Release …\` tickets (linked as **Predecessors**) and its Acceptance Criteria lists the corresponding \`@aurodesignsystem/*\` dependency bumps that must ship with it."
    fi

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
    jq -n --arg title "$TITLE" --arg area "$AREA_PATH" --arg iter "$ITER_PATH" --arg state "$STATE" \
          --arg desc "$DESC" --arg ac "$AC" --arg target "$TARGET_DATE" --arg tag "$RCS_TAG" --argjson preds "$PREDS" '
      [ {op:"add",path:"/fields/System.Title",value:$title},
        {op:"add",path:"/fields/System.AreaPath",value:$area},
        {op:"add",path:"/fields/System.IterationPath",value:$iter},
        {op:"add",path:"/fields/System.State",value:$state},
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

    # readable draft — printf '%s' so backslashes in area/iteration paths (e.g. \auro-*) print literally
    PCOUNT=$(printf '%s\n' "$IDS" | grep -c .)
    PREDLIST=$(printf '%s' "$IDS" | tr '\n' ' ')
    printf '%s\n' "──────────────────────────────────────────────"
    printf 'AREA: %s\n' "$AREA"
    printf '  PARENT  User Story  "%s"\n' "$TITLE"
    printf '    Area Path:      %s\n' "$AREA_PATH"
    printf '    Iteration:      %s\n' "$ITER_PATH"
    printf '    State:          %s\n' "$STATE"
    printf '    Target Date:    %s\n' "$TARGET_DATE"
    printf '    Predecessors:   %s  ->  %s\n' "$PCOUNT" "$PREDLIST"
    if [ "$AREA" = "$DOCS" ] && [ -n "$OTHER_AREAS" ]; then
      printf '    + Predecessor links to every other area'"'"'s Release ticket (added at submit): %s\n' "$(printf '%s' "$OTHER_AREAS" | tr '\n' ' ')"
      printf '    + AC dependency-update checklist: %s\n' "$(awk 'NF{printf "%s ", $0}' /tmp/rcs_dep_pkgs.txt)"
    fi
    printf '  CHILD   Task        "Generate Release Notes"  (Parent -> "%s")\n' "$TITLE"
    printf '  CHILD   Task        "Update Dependencies"     (Parent -> "%s")\n' "$TITLE"
    printf '\n'
  done <<< "$AREAS"

  echo "Draft payloads written under /tmp/rcs_draft_*.json (nothing submitted yet)."
}

cmd_scan_links(){
  load_iter; need_pat
  [ -f /tmp/rcs_labeled.tsv ] || die "NO_PLAN — run \`rcs.sh plan\` first."
  # Fresh decision files every scan, so 3B/3D work with nothing to reconcile and a re-scan starts clean.
  : > /tmp/rcs_reuse.tsv   # area <TAB> existingReleaseId                               (Scenario B "yes")
  : > /tmp/rcs_moves.tsv   # ticketId <TAB> oldReleaseId <TAB> area                     (Scenario A "yes")
  : > /tmp/rcs_left.tsv    # ticketId <TAB> oldReleaseId <TAB> releaseIter <TAB> area   (Scenario A "no")
  : > /tmp/rcs_succ.tsv; : > /tmp/rcs_releases.tsv; : > /tmp/rcs_links.tsv

  # 1) every sprint ticket's Successor (Dependency-Forward) targets -> "ticketId <TAB> candidateReleaseId".
  #    A ticket sits on the Successor side of the Predecessor link the skill creates.
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
  if [ "$TOTAL_LINKS" -gt 0 ]; then echo "  area / ticket / release / iter / class / title"; cat /tmp/rcs_links.tsv; fi
}

# Record one reconciliation answer. Release iteration and area are looked up from the scan, so the
# caller never has to quote a backslash-laden Iteration Path. Re-recording the same answer is a no-op.
cmd_decide(){
  [ -f /tmp/rcs_links.tsv ] || die "NO_SCAN — run \`rcs.sh scan-links\` first."
  KIND="$1"; shift
  case "$KIND" in
    reuse)
      [ $# -eq 2 ] || die "usage: rcs.sh decide reuse <area> <releaseId>"
      ROW=$(awk -F'\t' -v a="$1" -v r="$2" '$1==a && $3==r && $5=="this"{ print $1"\t"$3; exit }' /tmp/rcs_links.tsv)
      [ -n "$ROW" ] || die "NO_SUCH_LINK — no $1 ticket is linked to this-sprint Release #$2 in the scan."
      FILE=/tmp/rcs_reuse.tsv ;;
    move|leave)
      [ $# -eq 2 ] || die "usage: rcs.sh decide $KIND <ticketId> <releaseId>"
      # links.tsv: area ticket release releaseIter class title
      #   moves.tsv: ticket release area      left.tsv: ticket release releaseIter area
      ROW=$(awk -F'\t' -v t="$1" -v r="$2" -v k="$KIND" '$2==t && $3==r && $5=="other"{
              if (k=="move") print $2"\t"$3"\t"$1; else print $2"\t"$3"\t"$4"\t"$1; exit }' /tmp/rcs_links.tsv)
      [ -n "$ROW" ] || die "NO_SUCH_LINK — ticket #$1 has no out-of-sprint link to Release #$2 in the scan."
      if [ "$KIND" = "move" ]; then FILE=/tmp/rcs_moves.tsv; else FILE=/tmp/rcs_left.tsv; fi ;;
    *) die "usage: rcs.sh decide reuse <area> <releaseId> | move <ticketId> <releaseId> | leave <ticketId> <releaseId>" ;;
  esac
  grep -qxF "$ROW" "$FILE" || printf '%s\n' "$ROW" >> "$FILE"
  echo "recorded: $KIND $*"
}

# A forced AuroDocsSite area with no sprint tickets never appears in the successor-link scan, so on a
# re-run its existing ticket would be invisible and a duplicate would be created. Query for it directly.
cmd_docs_reuse(){
  load_iter; need_pat
  [ -f /tmp/rcs_reuse.tsv ] || die "NO_SCAN — run \`rcs.sh scan-links\` first."
  DOCS_AREA="$PFX\\$DOCS"
  if ! grep -qxF "$DOCS" /tmp/rcs_areas.txt; then echo "AuroDocsSite is not releasing this sprint — nothing to reuse."; return; fi
  if cut -f1 /tmp/rcs_reuse.tsv | grep -qxF "$DOCS"; then echo "AuroDocsSite already set to reuse an existing Release ticket."; return; fi
  ESC_ITER=$(printf '%s' "$ITER_PATH" | sed "s/'/''/g"); ESC_DOCS=$(printf '%s' "$DOCS_AREA" | sed "s/'/''/g")
  Q="SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '$ESC_ITER' AND [System.AreaPath] = '$ESC_DOCS' AND [System.WorkItemType] = 'User Story' AND [System.Tags] CONTAINS 'auro-rcs' ORDER BY [System.Id]"
  BODY=$(jq -cn --arg q "$Q" '{query:$q}')
  HTTP=$(curl -sS -u ":$ADO_PAT" -o /tmp/rcs_docs_wiql.json -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    --data-binary "$BODY" "$BASE/wiql?api-version=7.0")
  need_200 "AuroDocsSite query" "$HTTP"
  DID=$(jq -r '.workItems[0].id // empty' /tmp/rcs_docs_wiql.json)
  if [ -n "$DID" ]; then
    printf '%s\t%s\n' "$DOCS" "$DID" >> /tmp/rcs_reuse.tsv
    echo "Existing this-sprint AuroDocsSite Release ticket #$DID found — will reuse it (no duplicate)."
  else
    echo "No existing this-sprint AuroDocsSite Release ticket — a new one will be created."
  fi
}

# ---------------------------------------------------------------------------------------------
# Step 3B — preview (no writes)
# ---------------------------------------------------------------------------------------------

cmd_preview(){
  load_iter
  [ -f /tmp/rcs_areas.txt ] && [ -f /tmp/rcs_reuse.tsv ] || die "NO_PLAN — run \`rcs.sh plan\` and \`rcs.sh scan-links\` first."
  TARGET_DATE="${FINISH}T00:00:00Z"
  AREAS=$(cat /tmp/rcs_areas.txt)
  OTHER_AREAS=$(grep -vxF "$DOCS" /tmp/rcs_areas.txt)
  echo "=================  PLANNED CHANGES  ================="
  [ -s /tmp/rcs_repo.tsv ] && awk -F'\t' '{printf "Repo mode: %s  (%s, dev not yet on main + in-flight %s tickets)\n",$1,$2,$3}' /tmp/rcs_repo.tsv
  echo; echo "Reuse existing this-sprint Release tickets (no new ticket created):"
  if [ -s /tmp/rcs_reuse.tsv ]; then
    while IFS=$'\t' read -r A RID; do [ -z "$A" ] && continue
      printf '  %s  ->  Release #%s   (add Predecessor links for this area'"'"'s tickets)\n' "$A" "$RID"
      if [ "$A" = "$DOCS" ] && [ -n "$OTHER_AREAS" ]; then
        if [ -s /tmp/rcs_repo.tsv ]; then
          printf '      + Predecessor link to the repo'"'"'s Release ticket, + add %s to the AC dependency checklist (existing items kept)\n' \
            "$(awk 'NF{printf "%s ", $0}' /tmp/rcs_dep_pkgs.txt)"
        else
          printf '      + Predecessor links to every other Release ticket this sprint, + refresh AC dependency-update checklist\n'
        fi
      fi
    done < /tmp/rcs_reuse.tsv
  else echo "  (none)"; fi

  echo; echo "Create new Release tickets:"
  REUSE_AREAS=$(cut -f1 /tmp/rcs_reuse.tsv | sort -u)
  while IFS= read -r AREA; do [ -z "$AREA" ] && continue
    printf '%s\n' "$REUSE_AREAS" | grep -qxF "$AREA" && continue
    SAFE=$(printf '%s' "$AREA" | tr '\\/ ' '___')
    PC=$(jq '[.[]|select(.path=="/relations/-")]|length' "/tmp/rcs_draft_${SAFE}_parent.json")
    ST=$(jq -r '.[]|select(.path=="/fields/System.State")|.value' "/tmp/rcs_draft_${SAFE}_parent.json")
    printf '  Release %s - %s   [User Story, %s, Target %s, tag %s]  Predecessors: %s  (+ Generate Release Notes, + Update Dependencies)\n' \
      "$AREA" "$ITER_NAME" "$ST" "$TARGET_DATE" "$RCS_TAG" "$PC"
    if [ "$AREA" = "$DOCS" ] && [ -n "$OTHER_AREAS" ]; then
      printf '      + Predecessor links to every other Release ticket, + AC dependency-update checklist: %s\n' \
        "$(awk 'NF{printf "%s ", $0}' /tmp/rcs_dep_pkgs.txt)"
    fi
  done <<< "$AREAS"

  echo; echo "Move links to this sprint (remove old out-of-sprint link):"
  if [ -s /tmp/rcs_moves.tsv ]; then awk -F'\t' '{printf "  ticket #%s : unlink Release #%s, keep this-sprint %s Release\n",$1,$2,$3}' /tmp/rcs_moves.tsv
  else echo "  (none)"; fi

  echo; echo "Left linked to out-of-sprint Release tickets (unchanged):"
  if [ -s /tmp/rcs_left.tsv ]; then awk -F'\t' '{printf "  ticket #%s : stays linked to Release #%s (%s)\n",$1,$2,$3}' /tmp/rcs_left.tsv
  else echo "  none fall into this group"; fi
  echo "===================================================="
}

# ---------------------------------------------------------------------------------------------
# Step 3D — apply (the only writes; run only after the user's explicit "yes")
# ---------------------------------------------------------------------------------------------

post_wi(){ # $1=url-encoded type  $2=payload-file  -> echoes new id (empty on failure; logs it)
  local resp code body
  resp=$(curl -sS -u ":$ADO_PAT" -w $'\n%{http_code}' -X POST \
    -H "Content-Type: application/json-patch+json" --data-binary @"$2" \
    "$BASE/workitems/\$$1?api-version=7.1")   # 7.1 required: multilineFieldsFormat (Markdown) is ignored on 7.0
  code=$(printf '%s' "$resp" | sed -n '$p'); body=$(printf '%s' "$resp" | sed '$d')
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then printf '%s' "$body" | jq -r '.id'
  else printf 'CREATE %s FAILED http=%s\t%s\n' "$1" "$code" "$(printf '%s' "$body" | tr '\n' ' ' | cut -c1-200)" >> /tmp/rcs_apply_fail.tsv; fi
}

cmd_apply(){
  load_iter; need_pat
  [ -f /tmp/rcs_areas.txt ] && [ -f /tmp/rcs_reuse.tsv ] || die "NO_PLAN — run \`rcs.sh plan\` and \`rcs.sh scan-links\` first."
  # Process areas with AuroDocsSite LAST, so every other Release ticket's id is known before we
  # Predecessor-link the docs release to them. Each area's resulting Release id is recorded to
  # /tmp/rcs_relids.tsv (area <TAB> releaseId) as it is created or reused.
  AREAS=$(grep -vxF "$DOCS" /tmp/rcs_areas.txt; grep -xF "$DOCS" /tmp/rcs_areas.txt)
  : > /tmp/rcs_applied.tsv; : > /tmp/rcs_apply_fail.tsv; : > /tmp/rcs_relids.tsv

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
        if [ "$code" = "200" ]; then printf 'LINK\t%s\t->\t%s\n' "$TID" "$RELID" >> /tmp/rcs_applied.tsv
        else printf 'LINK ADD FAILED http=%s ticket=%s release=%s\n' "$code" "$TID" "$RELID" >> /tmp/rcs_apply_fail.tsv; fi
      done
      # AuroDocsSite only: refresh the Acceptance Criteria from the freshly-built draft so the dependency
      # checklist reflects THIS sprint's releases (reuse otherwise leaves fields untouched). The AC field op
      # plus its Markdown format op are lifted from the draft; 7.1 is required for multilineFieldsFormat.
      if [ "$AREA" = "$DOCS" ]; then
        if [ -s /tmp/rcs_repo.tsv ]; then
          # Repo mode knows only this repo's package, so ADD it to the existing checklist instead of
          # rebuilding (a rebuild would drop the other releases already listed). The checklist header and
          # item lines are lines 1-2 of the draft AC. No-op if the package is already listed or unpublished.
          ACOP=""
          DRAFT_AC=$(jq -r '.[] | select(.path=="/fields/Microsoft.VSTS.Common.AcceptanceCriteria") | .value' "/tmp/rcs_draft_${SAFE}_parent.json")
          NEWPKG=$(sed -n 1p /tmp/rcs_dep_pkgs.txt)
          CUR=$(curl -sS -u ":$ADO_PAT" "$BASE/workitems/$RELID?fields=Microsoft.VSTS.Common.AcceptanceCriteria&api-version=7.1" \
            | jq -r '.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] // ""')
          if [ -z "$NEWPKG" ] || printf '%s' "$CUR" | grep -qF "\`$NEWPKG\`"; then
            :   # nothing to add
          elif printf '%s' "$CUR" | grep -q '^[[:space:]]*<'; then
            printf 'AC NOT UPDATED (stored as HTML) release=%s — add `%s` to its dependency checklist by hand\n' "$RELID" "$NEWPKG" >> /tmp/rcs_apply_fail.tsv
          else
            DEP_ITEM=$(printf '%s\n' "$DRAFT_AC" | sed -n 2p)
            if printf '%s\n' "$CUR" | grep -q '^  - \[[ xX]\] `@'; then
              # insert after the last existing dependency item
              NEWAC=$(printf '%s\n' "$CUR" | awk -v item="$DEP_ITEM" '
                { l[NR]=$0; if ($0 ~ /^  - \[[ xX]\] `@/) last=NR }
                END{ for (i=1; i<=NR; i++) { print l[i]; if (i==last) print item } }')
            else
              # no checklist yet: prepend the header + this item
              NEWAC="$(printf '%s\n' "$DRAFT_AC" | sed -n 1,2p)${CUR:+
$CUR}"
            fi
            ACOP=$(jq -cn --arg ac "$NEWAC" '[{op:"add",path:"/fields/Microsoft.VSTS.Common.AcceptanceCriteria",value:$ac},
              {op:"add",path:"/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria",value:"Markdown"}]')
          fi
        else
          ACOP=$(jq -c '[ .[] | select(.path=="/fields/Microsoft.VSTS.Common.AcceptanceCriteria"
                                    or .path=="/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria") ]' \
                 "/tmp/rcs_draft_${SAFE}_parent.json")
        fi
        if [ -n "$ACOP" ]; then
          code=$(curl -sS -u ":$ADO_PAT" -o /dev/null -w "%{http_code}" -X PATCH \
            -H "Content-Type: application/json-patch+json" --data-binary "$ACOP" "$BASE/workitems/$RELID?api-version=7.1")
          if [ "$code" = "200" ]; then printf 'ACUPDATE\t%s\tAcceptanceCriteria\n' "$RELID" >> /tmp/rcs_applied.tsv
          else printf 'AC UPDATE FAILED http=%s release=%s\n' "$code" "$RELID" >> /tmp/rcs_apply_fail.tsv; fi
        fi
      fi
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

    # record this area's Release id (used to Predecessor-link the AuroDocsSite release to the others)
    [ -n "$RELID" ] && printf '%s\t%s\n' "$AREA" "$RELID" >> /tmp/rcs_relids.tsv

    # AuroDocsSite only (processed last): gate the docs release on every OTHER area's Release ticket by
    # adding a Predecessor link to each. Dedup against links already present so re-runs are idempotent.
    if [ "$AREA" = "$DOCS" ] && [ -n "$RELID" ]; then
      LINKED=$(curl -sS -u ":$ADO_PAT" "$BASE/workItems/$RELID?\$expand=relations&api-version=7.0" \
        | jq -r '[.relations[]? | select(.rel=="System.LinkTypes.Dependency-Reverse") | (.url|sub(".*/[wW]ork[iI]tems/";""))][]')
      awk -F'\t' -v d="$DOCS" '$1!=d{print $2}' /tmp/rcs_relids.tsv | while IFS= read -r OTHERID; do
        [ -z "$OTHERID" ] && continue
        printf '%s\n' "$LINKED" | grep -qxF "$OTHERID" && continue   # already linked
        OP=$(jq -cn --arg url "$ORG_WI/$OTHERID" '[{op:"add",path:"/relations/-",value:{rel:"System.LinkTypes.Dependency-Reverse",url:$url,attributes:{comment:"AuroDocsSite dependency bump — aligns with this release"}}}]')
        code=$(curl -sS -u ":$ADO_PAT" -o /dev/null -w "%{http_code}" -X PATCH \
          -H "Content-Type: application/json-patch+json" --data-binary "$OP" "$BASE/workitems/$RELID?api-version=7.0")
        if [ "$code" = "200" ]; then printf 'RELLINK\t%s\t->\t%s\n' "$RELID" "$OTHERID" >> /tmp/rcs_applied.tsv
        else printf 'RELLINK ADD FAILED http=%s docs=%s release=%s\n' "$code" "$RELID" "$OTHERID" >> /tmp/rcs_apply_fail.tsv; fi
      done
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
        if [ "$code" = "200" ]; then printf 'UNLINK\t%s\tfrom\t%s\n' "$TID" "$OLD" >> /tmp/rcs_applied.tsv
        else printf 'UNLINK FAILED http=%s ticket=%s release=%s\n' "$code" "$TID" "$OLD" >> /tmp/rcs_apply_fail.tsv; fi
      fi
    done
  done <<< "$AREAS"

  echo "apply complete. successes: $(grep -c . /tmp/rcs_applied.tsv), failures: $(grep -c . /tmp/rcs_apply_fail.tsv)"
}

# ---------------------------------------------------------------------------------------------
# Step 3E — summary
# ---------------------------------------------------------------------------------------------

cmd_summary(){
  echo "==================  SUMMARY  =================="
  if [ -s /tmp/rcs_applied.tsv ]; then
    echo "Applied to Azure DevOps:"
    awk -F'\t' '
      $1=="CREATE"{printf "  created %s #%s  %s\n",$2,$3,$4}
      $1=="LINK"  {printf "  linked ticket #%s -> Release #%s\n",$2,$4}
      $1=="RELLINK"{printf "  linked AuroDocsSite Release #%s -> depends on Release #%s\n",$2,$4}
      $1=="ACUPDATE"{printf "  refreshed %s on AuroDocsSite Release #%s\n",$3,$2}
      $1=="UNLINK"{printf "  unlinked ticket #%s from Release #%s\n",$2,$4}' /tmp/rcs_applied.tsv
  else echo "No changes were submitted."; fi
  if [ -s /tmp/rcs_apply_fail.tsv ]; then echo; echo "Failures (review and re-run):"; cat /tmp/rcs_apply_fail.tsv; fi
  echo; echo "Tickets left linked to Release tickets NOT in this sprint:"
  if [ -s /tmp/rcs_left.tsv ]; then awk -F'\t' '{printf "  ticket #%s -> Release #%s (%s)\n",$1,$2,$3}' /tmp/rcs_left.tsv
  else echo "  none fall into this group"; fi
  echo "=============================================="
}

# ---------------------------------------------------------------------------------------------

CMD="$1"; [ $# -gt 0 ] && shift
case "$CMD" in
  mode)        cmd_mode "$@" ;;
  repo-area)   cmd_repo_area "$@" ;;
  iterations)  cmd_iterations ;;
  iter-select) cmd_iter_select "$@" ;;
  gather)      cmd_gather ;;
  plan)        cmd_plan "$@" ;;
  scan-links)  cmd_scan_links ;;
  decide)      cmd_decide "$@" ;;
  docs-reuse)  cmd_docs_reuse ;;
  preview)     cmd_preview ;;
  apply)       cmd_apply ;;
  summary)     cmd_summary ;;
  *) die "usage: rcs.sh mode|repo-area|iterations|iter-select|gather|plan|scan-links|decide|docs-reuse|preview|apply|summary [args]" ;;
esac
