#!/usr/bin/env bash
# capture.sh — the GitHub / Azure DevOps calls behind the capture-standard skill.
#
# The skill runs every step as ONE plain command, `capture.sh <command> [args]`, so the single
# `allowed-tools` rule in SKILL.md approves it. A compound shell command (variable assignments,
# `$(...)`, redirects, pipes) can't match an allow rule, so in auto mode it falls through to the
# classifier. Keep all shell logic in here, not in the skill body. (Same contract as create-rcs's rcs.sh.)
#
# Each command runs in a fresh process, so state passes between steps through /tmp/capture_* files:
#   /tmp/capture_run.tsv        releasing repo, label, base ref, head ref, capture branch on auro-ai,
#                               and both refs pinned to SHAs so every later step reads the same range
#   /tmp/capture_tickets.tsv    every ticket/PR the range references: kind (ado|pr), number, short sha
#   /tmp/capture_ado.tsv        ADO facts per ticket: id, type, state, closed date, title
#   /tmp/capture_pm/            the post-mortems the range carries, read from the head ref
#   /tmp/capture_sections.md    located lessons sections, raw text (also .json)
#   /tmp/capture_corpus_ref.tsv corpus ref, its commit sha
#   /tmp/capture_corpus/        the coding-standards reference files at that sha
#   /tmp/capture_next_ids.tsv   next free ID per category
#   /tmp/capture_pr.tsv         the open capture PR for this branch, if any: number, url, review ticket
#   /tmp/capture_out/           WRITTEN BY THE MODEL: the full proposed text of each changed category file
#   /tmp/capture_pr_body.md     WRITTEN BY THE MODEL: the PR body, with a {{REVIEW_TICKET}} placeholder
#   /tmp/capture_result.txt     the one-line result release prep shows
#
# Commands, in skill order:
#   range <repo> <branch | from..to>   Step 1 — what is being released
#   tickets                            Step 2 — AB# and PR numbers in the range, plus their ADO state
#   postmortems                        Step 2 — the post-mortems the head ref carries for them
#   sections                           Step 3 — locate lessons sections (locate-sections.mjs)
#   corpus [<ref>]                     Step 4 — fetch the corpus from auro-ai at <ref> (default main)
#   next-ids                           Step 4 — next free ID per category (corpus + other open capture PRs)
#   open-pr                            Step 4 — find this branch's open capture PR and its review ticket
#   check                              Step 5 — run the corpus ref's validator over /tmp/capture_out
#   publish                            Step 6 — the ONLY command that writes: branch, PR, review ticket
#
# Auth: GitHub through the runner's `gh` login; ADO through $ADO_PAT (HTTP Basic, empty username).
# The token is never printed. Written for macOS's bash 3.2: no associative arrays, no mapfile.

DIR="$(cd "$(dirname "$0")" && pwd)"
OWNER="AlaskaAirlines"
AI_REPO="AlaskaAirlines/auro-ai"
REFS="plugins/auro/skills/coding-standards/references"
SKILL_MD="plugins/auro/skills/coding-standards/SKILL.md"
VALIDATOR="scripts/validate-standards.mjs"
ADO="https://itsals.visualstudio.com/E_Retain_Content/_apis/wit"
AREA='E_Retain_Content\Auro Design System\auro-ai'
ROOT_ITER='E_Retain_Content'
TAG="coding-standards-capture"
PLACEHOLDER='{{REVIEW_TICKET}}'

die(){ printf '%s\n' "$*"; exit 1; }
# `gh auth token` is local; `gh auth status` makes a network call per account and fails intermittently.
need_gh(){ gh auth token >/dev/null 2>&1 || die "GH_AUTH_MISSING — run \`gh auth login\`."; }
need_run(){
  [ -s /tmp/capture_run.tsv ] || die "NO_RANGE — run \`capture.sh range\` first."
  IFS=$'\t' read -r REPO LABEL BASE HEAD BRANCH BASE_SHA HEAD_SHA < /tmp/capture_run.tsv
}
need_corpus(){
  [ -s /tmp/capture_corpus_ref.tsv ] || die "NO_CORPUS — run \`capture.sh corpus\` first."
  IFS=$'\t' read -r CORPUS_REF CORPUS_SHA < /tmp/capture_corpus_ref.tsv
}

# The PAT reaches curl on stdin as a config line, never in argv where `ps` would show it.
ado_curl(){ printf 'user = ":%s"\n' "$ADO_PAT" | curl -K - "$@"; }

# This branch's open PR on auro-ai itself. `gh pr list --head` also matches a fork's branch of the same
# name, and publish would then rewrite that stranger's PR body and adopt its review ticket.
own_pr(){
  gh api "repos/$AI_REPO/pulls?state=open&head=$OWNER:$(enc "$BRANCH")" \
    --jq '.[0] // empty | {number, url: .html_url, body}'
}

# A ref as one URL path segment or query value: branch names here can carry `#` (AB#…) and `/`.
enc(){ printf '%s' "$1" | jq -sRr @uri; }

# A ref name safe inside `capture/<repo>-<label>`: no `/`, no `..`, nothing git rejects.
safe_label(){ printf '%s' "$1" | sed -e 's#\.\.#-#g' -e 's#[/ ]#-#g' -e 's#[^A-Za-z0-9._-]##g' -e 's#^[.-]*##' -e 's#[.]*$##'; }

# The review ticket recorded in a PR body, or nothing.
ticket_in_body(){ grep -oE '\*\*Review ticket:\*\* AB#[0-9]{7}' | head -1 | grep -oE '[0-9]{7}'; }

# ---------------------------------------------------------------------------------------------
# Step 1 — range
# ---------------------------------------------------------------------------------------------

cmd_range(){
  [ $# -eq 2 ] || die "usage: capture.sh range <repo> <branch | from..to>"
  need_gh
  # A new run starts clean, so nothing from an earlier release can leak into this one.
  rm -rf /tmp/capture_*

  case "$1" in */*) R="$1" ;; *) R="$OWNER/$1" ;; esac
  REPO_FULL=$(gh api "repos/$R" --jq .full_name 2>/dev/null) || die "REPO_NOT_FOUND — $R"

  case "$2" in
    *..*) BASE="${2%%..*}"; HEAD="${2##*..}"; LABEL=$(safe_label "$BASE-$HEAD") ;;
    *)    BASE="main";      HEAD="$2";       LABEL=$(safe_label "$2") ;;
  esac
  [ -n "$BASE" ] && [ -n "$HEAD" ] || die "BAD_RANGE — expected <from>..<to>, got $2"
  BASE_SHA=$(gh api "repos/$REPO_FULL/commits/$(enc "$BASE")" --jq .sha 2>/dev/null) || die "REF_NOT_FOUND — $BASE in $REPO_FULL"
  HEAD_SHA=$(gh api "repos/$REPO_FULL/commits/$(enc "$HEAD")" --jq .sha 2>/dev/null) || die "REF_NOT_FOUND — $HEAD in $REPO_FULL"

  NAME="${REPO_FULL#*/}"
  BRANCH="capture/$NAME-$LABEL"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$REPO_FULL" "$LABEL" "$BASE" "$HEAD" "$BRANCH" "$BASE_SHA" "$HEAD_SHA" > /tmp/capture_run.tsv

  AHEAD=$(gh api "repos/$REPO_FULL/compare/$BASE_SHA...$HEAD_SHA?per_page=1" --jq .ahead_by)
  echo "repo: $REPO_FULL"
  echo "range: $BASE...$HEAD  ($AHEAD commits on $HEAD not on $BASE)"
  echo "capture branch: $BRANCH"
  # Since for every rule this run creates, and the date D14 picks the review ticket's sprint by.
  echo "run date: $(date +%Y-%m-%d)"
  [ "$AHEAD" = "0" ] && echo "EMPTY_RANGE — nothing is being released."
  echo "RANGE_OK"
}

# ---------------------------------------------------------------------------------------------
# Step 2 — tickets and post-mortems
# ---------------------------------------------------------------------------------------------

cmd_tickets(){
  need_run
  # Every commit's full message, so AB# references in bodies are caught too — create-rcs repo mode's logic.
  gh api --paginate "repos/$REPO/compare/$BASE_SHA...$HEAD_SHA?per_page=100" \
    --jq '.commits[] | "@@COMMIT \(.sha)\n\(.commit.message)"' > /tmp/capture_msgs.txt
  AHEAD=$(gh api "repos/$REPO/compare/$BASE_SHA...$HEAD_SHA?per_page=1" --jq .ahead_by)
  N=$(grep -c '^@@COMMIT ' /tmp/capture_msgs.txt)
  echo "commits read: $N (GitHub reports $AHEAD ahead)"
  [ "$N" -lt "$AHEAD" ] && echo "WARNING_INCOMPLETE — some commits were not read; tickets may be missing."

  # ado <id> <sha7> for each AB#nnnnnnn; pr <n> <sha7> for each `Merge pull request #N` and each
  # squash-merge `(#N)` subject. PR numbers only matter for post-mortems named by PR (§2.4), so
  # over-matching them is harmless — under-matching loses a post-mortem silently.
  awk '/^@@COMMIT /{ sha=substr($2,1,7); first=1; next }
       { s=$0
         while (match(s, /AB#[0-9]+/)) { id=substr(s, RSTART+3, RLENGTH-3); if (length(id)==7) print "ado\t" id "\t" sha; s=substr(s, RSTART+RLENGTH) }
         if (match($0, /^Merge pull request #[0-9]+/)) { m=substr($0, RSTART, RLENGTH); sub(/.*#/, "", m); print "pr\t" m "\t" sha }
         if (first && match($0, /\(#[0-9]+\)[[:space:]]*$/)) { m=substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", m); print "pr\t" m "\t" sha }
         first=0 }' /tmp/capture_msgs.txt | sort -u > /tmp/capture_tickets.tsv

  awk -F'\t' '$1=="ado"{print $2}' /tmp/capture_tickets.tsv | sort -un > /tmp/capture_ado_ids.txt
  awk -F'\t' '$1=="pr"{print $2}' /tmp/capture_tickets.tsv | sort -un > /tmp/capture_pr_ids.txt
  echo "tickets: $(grep -c . /tmp/capture_ado_ids.txt)   pull requests: $(grep -c . /tmp/capture_pr_ids.txt)"

  # ADO facts. The closed date is what escape detection (D7) compares to a rule's Since. Without a
  # token the run continues — locating and extraction need no ADO — but D7 cannot run.
  : > /tmp/capture_ado.tsv
  if [ -z "$ADO_PAT" ]; then
    echo "ADO_PAT_MISSING — continuing without ticket states; escape detection (D7) is skipped and no review ticket can be created."
  elif [ -s /tmp/capture_ado_ids.txt ]; then
    IDS=$(jq -R 'select(length>0)|tonumber' /tmp/capture_ado_ids.txt | jq -sc '.')
    TOTAL=$(jq length <<<"$IDS")
    for S in $(seq 0 200 $((TOTAL-1))); do
      CHUNK=$(jq -c --argjson s "$S" '{ids:.[$s:$s+200], errorPolicy:"omit", fields:["System.WorkItemType","System.State","Microsoft.VSTS.Common.ClosedDate","System.Title"]}' <<<"$IDS")
      RESP=$(ado_curl -sS -w $'\n%{http_code}' -X POST -H "Content-Type: application/json" \
        --data-binary "$CHUNK" "$ADO/workitemsbatch?api-version=7.0")
      CODE=$(printf '%s' "$RESP" | sed -n '$p')
      if [ "$CODE" != "200" ]; then
        echo "ADO_AUTH_FAILURE — workitemsbatch returned HTTP $CODE; continuing without ticket states."; : > /tmp/capture_ado.tsv; break
      fi
      printf '%s' "$RESP" | sed '$d' | jq -r '.value[] | select(. != null) | .fields as $f
        | "\(.id)\t\($f["System.WorkItemType"])\t\($f["System.State"])\t\(($f["Microsoft.VSTS.Common.ClosedDate"] // "")[:10])\t\(($f["System.Title"] // "") | gsub("[\t\n\r]"; " "))"' \
        >> /tmp/capture_ado.tsv
    done
  fi

  echo "--- tickets (id / type / state / closed / title) ---"
  while IFS= read -r ID; do
    [ -z "$ID" ] && continue
    ROW=$(awk -F'\t' -v i="$ID" '$1==i{print; exit}' /tmp/capture_ado.tsv)
    if [ -n "$ROW" ]; then printf '%s\n' "$ROW"; else printf '%s\t(no ADO data)\n' "$ID"; fi
  done < /tmp/capture_ado_ids.txt
  echo "--- pull requests merged in the range ---"
  tr '\n' ' ' < /tmp/capture_pr_ids.txt; echo
}

cmd_postmortems(){
  need_run
  [ -f /tmp/capture_ado_ids.txt ] || die "NO_TICKETS — run \`capture.sh tickets\` first."
  rm -rf /tmp/capture_pm; mkdir -p /tmp/capture_pm
  : > /tmp/capture_pm_index.tsv

  # <repo>/docs/post-mortem/ at the head ref is canonical (OQ-3). A repo with none answers 404.
  if ! gh api "repos/$REPO/contents/docs/post-mortem?ref=$HEAD_SHA" --jq '.[] | select(.type=="file") | .name' \
       > /tmp/capture_pm_names.txt 2>/dev/null; then
    : > /tmp/capture_pm_names.txt
    echo "no docs/post-mortem/ directory on $HEAD"
  fi

  while IFS= read -r NAME; do
    KEY="${NAME%.md}"
    case "$KEY" in *[!0-9]*|"") continue ;; esac
    if [ ${#KEY} -eq 7 ]; then LIST=/tmp/capture_ado_ids.txt; KIND=ticket; else LIST=/tmp/capture_pr_ids.txt; KIND=pr; fi
    grep -qxF "$KEY" "$LIST" || continue
    gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/docs/post-mortem/$NAME?ref=$HEAD_SHA" \
      > "/tmp/capture_pm/$NAME" || { echo "FETCH_FAILED — $NAME"; rm -f "/tmp/capture_pm/$NAME"; continue; }
    printf '%s\t%s\n' "$NAME" "$KIND" >> /tmp/capture_pm_index.tsv
  done < /tmp/capture_pm_names.txt

  echo "post-mortems carried by the range: $(grep -c . /tmp/capture_pm_index.tsv)"
  cut -f1 /tmp/capture_pm_index.tsv | sed 's/^/  /'
  echo "tickets with no post-mortem:"
  MISSING=$(cut -f1 /tmp/capture_pm_index.tsv | sed 's/\.md$//' | grep -vxF -f - /tmp/capture_ado_ids.txt)
  if [ -n "$MISSING" ]; then printf '%s\n' "$MISSING" | sed 's/^/  AB#/'; else echo "  none"; fi
  [ -s /tmp/capture_pm_index.tsv ] || echo "NO_POSTMORTEMS — nothing extractable from this range."
}

# ---------------------------------------------------------------------------------------------
# Step 3 — sections
# ---------------------------------------------------------------------------------------------

cmd_sections(){
  [ -d /tmp/capture_pm ] || die "NO_POSTMORTEMS — run \`capture.sh postmortems\` first."
  set -- /tmp/capture_pm/*.md
  [ -e "$1" ] || die "NO_POSTMORTEMS — nothing extractable from this range."
  node "$DIR/locate-sections.mjs" --json "$@" > /tmp/capture_sections.json || die "LOCATE_FAILED"
  node "$DIR/locate-sections.mjs" "$@" > /tmp/capture_sections.md || die "LOCATE_FAILED"
  cat /tmp/capture_sections.md
}

# ---------------------------------------------------------------------------------------------
# Step 4 — corpus, IDs, existing PR
# ---------------------------------------------------------------------------------------------

cmd_corpus(){
  need_gh
  REF="${1:-main}"
  SHA=$(gh api "repos/$AI_REPO/commits/$(enc "$REF")" --jq .sha 2>/dev/null) || die "CORPUS_REF_NOT_FOUND — $REF in $AI_REPO"
  # The PR is opened against the corpus ref (D3), and a PR base must be a branch.
  gh api "repos/$AI_REPO/branches/$(enc "$REF")" --jq .name >/dev/null 2>&1 \
    || die "CORPUS_REF_NOT_A_BRANCH — $REF; the capture PR targets the corpus ref, so pass a branch."
  # Written last, once the files are in hand, so a failed fetch leaves no corpus for later steps to trust.
  rm -rf /tmp/capture_corpus /tmp/capture_corpus_ref.tsv; mkdir -p /tmp/capture_corpus
  if ! gh api "repos/$AI_REPO/contents/$REFS?ref=$SHA" --jq '.[] | select(.name|endswith(".md")) | .name' \
       > /tmp/capture_corpus_names.txt 2>/dev/null || [ ! -s /tmp/capture_corpus_names.txt ]; then
    die "CORPUS_MISSING — $REF has no coding-standards references (Phase 1 not on it?). Pass the Phase 1 stack branch."
  fi
  while IFS= read -r NAME; do
    gh api -H "Accept: application/vnd.github.raw" "repos/$AI_REPO/contents/$REFS/$NAME?ref=$SHA" \
      > "/tmp/capture_corpus/$NAME" || die "FETCH_FAILED — $NAME at $REF"
  done < /tmp/capture_corpus_names.txt
  printf '%s\t%s\n' "$REF" "$SHA" > /tmp/capture_corpus_ref.tsv

  echo "corpus: $AI_REPO @ $REF ($(printf '%s' "$SHA" | cut -c1-7)) — $(grep -c . /tmp/capture_corpus_names.txt) category files"
  echo "--- rules (id / section / title / sources / since) ---"
  for F in /tmp/capture_corpus/*.md; do
    awk '
      /^##[[:space:]]+Rules[[:space:]]*$/   { sec="active"; next }
      /^##[[:space:]]+Retired[[:space:]]*$/ { sec="retired"; next }
      /^##[[:space:]]/                      { sec=""; next }
      function emit(){ if (id!="") printf "%s\t%s\t%s\t%s\t%s\n", id, s, title, src, since; id="" }
      /^###[[:space:]]+CS-/ { emit(); id=$2; s=sec; title=$0; sub(/^###[[:space:]]+[^[:space:]]+[[:space:]]+—[[:space:]]+/, "", title); src=""; since=""; next }
      /^- \*\*Sources:\*\*/ { src=$0; sub(/^- \*\*Sources:\*\*[[:space:]]*/, "", src); next }
      /^- \*\*Since:\*\*/   { since=$0; sub(/^- \*\*Since:\*\*[[:space:]]*/, "", since); next }
      END { emit() }' "$F"
  done
  echo "Read /tmp/capture_corpus/<category>.md for a rule's full text."
}

cmd_next_ids(){
  need_run; need_corpus
  # IDs are never reused (§3.2): count active, retired and tombstoned alike.
  grep -hoE '^###[[:space:]]+CS-[A-Z0-9]+-[0-9]{3}' /tmp/capture_corpus/*.md | awk '{print $2}' > /tmp/capture_ids_taken.txt

  # D8: another open capture PR may already have claimed the next number. Our own branch is excluded —
  # it is reset to a fresh proposal on publish, so its old IDs are free to be claimed again.
  gh pr list -R "$AI_REPO" --state open --limit 100 --json number,headRefName,headRefOid,isCrossRepository \
    --jq ".[] | select(.isCrossRepository | not) | select(.headRefName | startswith(\"capture/\")) | select(.headRefName != \"$BRANCH\") | \"\(.number)\t\(.headRefOid)\"" \
    > /tmp/capture_other_prs.tsv
  while IFS=$'\t' read -r NUM OID; do
    [ -z "$NUM" ] && continue
    for NAME in $(cat /tmp/capture_corpus_names.txt); do
      gh api -H "Accept: application/vnd.github.raw" "repos/$AI_REPO/contents/$REFS/$NAME?ref=$OID" 2>/dev/null \
        | grep -oE '^###[[:space:]]+CS-[A-Z0-9]+-[0-9]{3}' | awk '{print $2}' >> /tmp/capture_ids_taken.txt
    done
    echo "counted IDs claimed by open capture PR #$NUM"
  done < /tmp/capture_other_prs.tsv

  : > /tmp/capture_next_ids.tsv
  for NAME in $(cat /tmp/capture_corpus_names.txt); do
    CAT=$(printf '%s' "${NAME%.md}" | tr '[:lower:]' '[:upper:]')
    MAX=$(grep -E "^CS-$CAT-[0-9]{3}$" /tmp/capture_ids_taken.txt | sed 's/.*-//' | sort -n | tail -1)
    NEXT=$(printf 'CS-%s-%03d' "$CAT" $((10#${MAX:-0} + 1)))
    printf '%s\t%s\n' "$CAT" "$NEXT" >> /tmp/capture_next_ids.tsv
  done
  echo "--- next free ID per category (assign upward from here within this run) ---"
  cat /tmp/capture_next_ids.tsv
}

cmd_open_pr(){
  need_run
  own_pr > /tmp/capture_pr.json
  if [ ! -s /tmp/capture_pr.json ]; then
    : > /tmp/capture_pr.tsv
    echo "NO_OPEN_PR — publishing will open one from $BRANCH."
    return
  fi
  NUM=$(jq -r .number /tmp/capture_pr.json); URL=$(jq -r .url /tmp/capture_pr.json)
  TID=$(jq -r .body /tmp/capture_pr.json | ticket_in_body)
  printf '%s\t%s\t%s\n' "$NUM" "$URL" "$TID" > /tmp/capture_pr.tsv
  echo "OPEN_PR #$NUM $URL — publishing will reset its branch and replace its body."
  if [ -n "$TID" ]; then echo "review ticket: AB#$TID (kept)"; else echo "review ticket: none yet (one is created on publish)"; fi
}

# ---------------------------------------------------------------------------------------------
# Step 5 — check (local, no writes outside /tmp)
# ---------------------------------------------------------------------------------------------

# Changed category files: those in /tmp/capture_out whose text differs from the corpus copy.
changed_files(){
  for F in /tmp/capture_out/*.md; do
    [ -e "$F" ] || continue
    N=$(basename "$F")
    [ -f "/tmp/capture_corpus/$N" ] || { echo "UNKNOWN_CATEGORY $N"; continue; }
    cmp -s "$F" "/tmp/capture_corpus/$N" || echo "$N"
  done
}

cmd_check(){
  need_corpus
  [ -d /tmp/capture_out ] || die "NO_PROPOSAL — write the proposed category files to /tmp/capture_out/ first."
  CHANGED=$(changed_files)
  printf '%s\n' "$CHANGED" | grep -q '^UNKNOWN_CATEGORY' && die "$(printf '%s\n' "$CHANGED" | grep '^UNKNOWN_CATEGORY')"
  [ -n "$CHANGED" ] || die "NO_CHANGES — every proposed file matches the corpus; there is nothing to publish."

  # Run the corpus ref's own validator over the corpus with the proposal laid on top — the same check
  # CI runs on the PR, so a malformed proposal fails here instead of on the pull request.
  # The validator is fetched and then EXECUTED, so it goes in a private directory (mktemp -d is mode 700),
  # never a fixed shared /tmp path another local user could pre-create.
  W=$(mktemp -d "${TMPDIR:-/tmp}/capture_check.XXXXXX") || die "CHECK_FAILED — no scratch directory"
  trap 'rm -rf "$W"' EXIT
  mkdir -p "$W/scripts" "$W/$REFS"
  gh api -H "Accept: application/vnd.github.raw" "repos/$AI_REPO/contents/$VALIDATOR?ref=$CORPUS_SHA" > "$W/$VALIDATOR" \
    || die "FETCH_FAILED — $VALIDATOR at $CORPUS_REF"
  gh api -H "Accept: application/vnd.github.raw" "repos/$AI_REPO/contents/$SKILL_MD?ref=$CORPUS_SHA" > "$W/$SKILL_MD" \
    || die "FETCH_FAILED — $SKILL_MD at $CORPUS_REF"
  cp /tmp/capture_corpus/*.md "$W/$REFS/"
  for N in $CHANGED; do cp "/tmp/capture_out/$N" "$W/$REFS/$N"; done

  echo "changed: $(printf '%s' "$CHANGED" | tr '\n' ' ')"
  if node "$W/$VALIDATOR" > "$W/check.log" 2>&1; then
    echo "CHECK_OK"
  else
    grep -v 'staleness report\|rule(s)\|sources=' "$W/check.log"
    die "CHECK_FAILED — fix the proposal in /tmp/capture_out/ and re-run \`capture.sh check\`."
  fi
}

# ---------------------------------------------------------------------------------------------
# Step 6 — publish (the only writes; run only after the user's explicit yes)
# ---------------------------------------------------------------------------------------------

# The sprint whose dates contain today, as an Iteration Path; the project root if none does (D14).
sprint_for_today(){
  CODE=$(ado_curl -sS -o /tmp/capture_iters.json -w "%{http_code}" \
    "$ADO/classificationnodes/Iterations?\$depth=2&api-version=7.0")
  [ "$CODE" = "200" ] || return 1
  TODAY=$(date +%Y-%m-%d)
  jq -r --arg t "$TODAY" '[ .children[]? | select(.attributes?.startDate != null)
      | select(.attributes.startDate[:10] <= $t and $t <= .attributes.finishDate[:10]) ] | .[0].path // empty' \
    /tmp/capture_iters.json | sed -e 's#^\\##' -e 's#\\Iteration\\#\\#'
}

# Create the review User Story (D14). Echoes its id; empty on failure, with the reason in /tmp/capture_ticket.log.
create_ticket(){ # $1=PR url
  : > /tmp/capture_ticket.log
  [ -n "$ADO_PAT" ] || { echo "ADO_PAT_MISSING — no review ticket created" > /tmp/capture_ticket.log; return; }
  ITER=$(sprint_for_today) || { echo "ADO_AUTH_FAILURE — iterations lookup failed" > /tmp/capture_ticket.log; return; }
  ROOTED=""
  if [ -z "$ITER" ]; then ITER="$ROOT_ITER"; ROOTED=1; fi
  printf '%s\n' "$ITER" > /tmp/capture_ticket_iter.txt
  [ -n "$ROOTED" ] && echo "ROOT_ITERATION" >> /tmp/capture_ticket_iter.txt

  NAME="${REPO#*/}"
  # No angle brackets anywhere: ADO strips anything shaped like an HTML tag from Markdown fields.
  DESC="Review the coding-standards capture pull request for \`$NAME\` \`$LABEL\`: $1

Capture proposes rules distilled from the post-mortems this release carries. Each candidate in the PR body states its outcome and reason; check the flagged categories, derived candidates and escape stubs before approving. Nothing reaches the corpus until the PR is merged."
  jq -n --arg title "Review coding-standards capture for $NAME $LABEL" --arg area "$AREA" --arg iter "$ITER" \
        --arg tag "$TAG" --arg desc "$DESC" --arg url "$1" '
    [ {op:"add",path:"/fields/System.Title",value:$title},
      {op:"add",path:"/fields/System.AreaPath",value:$area},
      {op:"add",path:"/fields/System.IterationPath",value:$iter},
      {op:"add",path:"/fields/System.Tags",value:$tag},
      {op:"add",path:"/fields/System.Description",value:$desc},
      {op:"add",path:"/multilineFieldsFormat/System.Description",value:"Markdown"},
      {op:"add",path:"/relations/-",value:{rel:"Hyperlink",url:$url,attributes:{comment:"coding-standards capture PR"}}} ]' \
    > /tmp/capture_ticket.json

  # ADO creates a User Story only as New; Committed is a second call.
  RESP=$(ado_curl -sS -w $'\n%{http_code}' -X POST -H "Content-Type: application/json-patch+json" \
    --data-binary @/tmp/capture_ticket.json "$ADO/workitems/\$User%20Story?api-version=7.1")
  CODE=$(printf '%s' "$RESP" | sed -n '$p')
  if [ "$CODE" != "200" ]; then
    printf 'CREATE FAILED http=%s %s\n' "$CODE" "$(printf '%s' "$RESP" | sed '$d' | tr '\n' ' ' | cut -c1-200)" > /tmp/capture_ticket.log; return
  fi
  ID=$(printf '%s' "$RESP" | sed '$d' | jq -r .id)
  CODE=$(ado_curl -sS -o /dev/null -w "%{http_code}" -X PATCH -H "Content-Type: application/json-patch+json" \
    --data-binary '[{"op":"add","path":"/fields/System.State","value":"Committed"}]' "$ADO/workitems/$ID?api-version=7.1")
  [ "$CODE" = "200" ] || echo "AB#$ID created but left New — moving it to Committed returned HTTP $CODE" > /tmp/capture_ticket.log
  echo "$ID"
}

# Replace the PR body (REST PATCH, never `gh pr edit` — see the pr skill).
patch_body(){ # $1=PR number  $2=body file
  gh api --method PATCH "repos/$AI_REPO/pulls/$1" -F "body=@$2" --jq .number >/dev/null
}

cmd_publish(){
  need_run; need_corpus
  [ -s /tmp/capture_pr_body.md ] || die "NO_PR_BODY — write the PR body to /tmp/capture_pr_body.md first."
  grep -qF "$PLACEHOLDER" /tmp/capture_pr_body.md || die "NO_PLACEHOLDER — the PR body must carry **Review ticket:** $PLACEHOLDER."
  cmd_check || exit 1
  CHANGED=$(changed_files)
  NAME="${REPO#*/}"
  TITLE="docs(coding-standards): capture lessons from $NAME $LABEL"

  # 1. One commit on the corpus ref's tip, built with the Git Data API — no clone (D5).
  BASE_TREE=$(gh api "repos/$AI_REPO/git/commits/$CORPUS_SHA" --jq .tree.sha) || die "PUBLISH_FAILED — base tree"
  echo '[]' > /tmp/capture_tree.json
  for N in $CHANGED; do
    BLOB=$(gh api --method POST "repos/$AI_REPO/git/blobs" -F "content=@/tmp/capture_out/$N" -f encoding=utf-8 --jq .sha) \
      || die "PUBLISH_FAILED — blob for $N"
    jq --arg p "$REFS/$N" --arg s "$BLOB" '. + [{path:$p, mode:"100644", type:"blob", sha:$s}]' /tmp/capture_tree.json > /tmp/capture_tree.next \
      && mv /tmp/capture_tree.next /tmp/capture_tree.json
  done
  jq -n --arg b "$BASE_TREE" --slurpfile t /tmp/capture_tree.json '{base_tree:$b, tree:$t[0]}' > /tmp/capture_tree_req.json
  TREE=$(gh api --method POST "repos/$AI_REPO/git/trees" --input /tmp/capture_tree_req.json --jq .sha) || die "PUBLISH_FAILED — tree"
  jq -n --arg m "$TITLE

Proposed by capture-standard from the post-mortems on $REPO $BASE...$HEAD.
See the pull request body for each candidate's outcome and reason." --arg t "$TREE" --arg p "$CORPUS_SHA" \
    '{message:$m, tree:$t, parents:[$p]}' > /tmp/capture_commit_req.json
  COMMIT=$(gh api --method POST "repos/$AI_REPO/git/commits" --input /tmp/capture_commit_req.json --jq .sha) || die "PUBLISH_FAILED — commit"

  # 2. Point the branch at it. A re-run resets the branch to this fresh proposal rather than appending (D6).
  if gh api "repos/$AI_REPO/git/ref/heads/$BRANCH" --jq .object.sha >/dev/null 2>&1; then
    gh api --method PATCH "repos/$AI_REPO/git/refs/heads/$BRANCH" -f sha="$COMMIT" -F force=true --jq .object.sha >/dev/null \
      || die "PUBLISH_FAILED — reset $BRANCH"
    echo "branch reset: $BRANCH -> $(printf '%s' "$COMMIT" | cut -c1-7)"
  else
    gh api --method POST "repos/$AI_REPO/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$COMMIT" --jq .ref >/dev/null \
      || die "PUBLISH_FAILED — create $BRANCH"
    echo "branch created: $BRANCH -> $(printf '%s' "$COMMIT" | cut -c1-7)"
  fi

  # 3. Find or open the PR. An existing review ticket is carried into the new body.
  own_pr > /tmp/capture_pr.json
  TID=""; OPENED=""
  if [ -s /tmp/capture_pr.json ]; then
    NUM=$(jq -r .number /tmp/capture_pr.json); URL=$(jq -r .url /tmp/capture_pr.json)
    TID=$(jq -r .body /tmp/capture_pr.json | ticket_in_body)
  fi
  if [ -n "$TID" ]; then REPL="AB#$TID"; else REPL="_pending — created when this PR is published_"; fi
  awk -v p="$PLACEHOLDER" -v r="$REPL" '{ while ((i = index($0, p)) > 0) $0 = substr($0, 1, i-1) r substr($0, i+length(p)); print }' \
    /tmp/capture_pr_body.md > /tmp/capture_pr_body.out
  if [ -n "$NUM" ]; then
    patch_body "$NUM" /tmp/capture_pr_body.out || die "PUBLISH_FAILED — body of #$NUM (branch $BRANCH was reset)"
    echo "PR updated: #$NUM $URL"
  else
    URL=$(gh pr create -R "$AI_REPO" --base "$CORPUS_REF" --head "$BRANCH" --title "$TITLE" --body-file /tmp/capture_pr_body.out) \
      || die "PUBLISH_FAILED — gh pr create (branch $BRANCH is pushed; re-run publish to retry)"
    NUM="${URL##*/}"; OPENED=1
    echo "PR opened: #$NUM $URL"
  fi

  # 4. The review ticket (D14) — only when the PR has none. A ticket failure never undoes the PR.
  RESULT="PR $URL"
  if [ -n "$TID" ]; then
    RESULT="$RESULT · review ticket AB#$TID (existing)"
  else
    NEWID=$(create_ticket "$URL")
    if [ -n "$NEWID" ]; then
      NOTE="AB#$NEWID"
      grep -q ROOT_ITERATION /tmp/capture_ticket_iter.txt 2>/dev/null && NOTE="$NOTE — no sprint covers $(date +%Y-%m-%d), so it is on the project's root iteration"
      awk -v p="$PLACEHOLDER" -v r="$NOTE" '{ while ((i = index($0, p)) > 0) $0 = substr($0, 1, i-1) r substr($0, i+length(p)); print }' \
        /tmp/capture_pr_body.md > /tmp/capture_pr_body.out
      patch_body "$NUM" /tmp/capture_pr_body.out || echo "WARNING — AB#$NEWID created but the PR body could not be updated; add it by hand."
      RESULT="$RESULT · review ticket AB#$NEWID"
      [ -s /tmp/capture_ticket.log ] && RESULT="$RESULT ($(cat /tmp/capture_ticket.log))"
    else
      RESULT="$RESULT · NO review ticket: $(cat /tmp/capture_ticket.log) — re-run publish to retry"
    fi
  fi
  [ -n "$OPENED" ] || RESULT="$RESULT · re-run: branch reset, body replaced"
  printf 'CAPTURE_RESULT: %s\n' "$RESULT" | tee /tmp/capture_result.txt
}

# ---------------------------------------------------------------------------------------------

CMD="$1"; [ $# -gt 0 ] && shift
case "$CMD" in
  range)       cmd_range "$@" ;;
  tickets)     cmd_tickets ;;
  postmortems) cmd_postmortems ;;
  sections)    cmd_sections ;;
  corpus)      cmd_corpus "$@" ;;
  next-ids)    cmd_next_ids ;;
  open-pr)     cmd_open_pr ;;
  check)       cmd_check ;;
  publish)     cmd_publish ;;
  *) die "usage: capture.sh range|tickets|postmortems|sections|corpus|next-ids|open-pr|check|publish [args]" ;;
esac
