#!/usr/bin/env bash
# Offline checks for the Phase 5a additions to capture.sh: validate_checks, rule_title,
# check_tickets_md, render_body, the check-ticket status classification, and the check-ticket reuse
# lookup and raising loop (with ADO stubbed).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# capture.sh keeps its state in fixed /tmp/capture_* paths, which these fixtures overwrite. Save any
# real run's state first and put it back afterwards, so running this mid-capture loses nothing. The
# test's own files use another prefix: with TMPDIR unset, a capture_* name would be swept up as state.
LIB=$(mktemp "${TMPDIR:-/tmp}/cschk_lib.XXXXXX") || exit 1
SAVED=$(mktemp -d "${TMPDIR:-/tmp}/cschk_saved.XXXXXX") || exit 1
for P in /tmp/capture_*; do [ -e "$P" ] && mv "$P" "$SAVED/"; done
restore(){ rm -rf /tmp/capture_*; for P in "$SAVED"/capture_*; do [ -e "$P" ] && mv "$P" /tmp/; done; rm -rf "$SAVED" "$LIB"; }
trap restore EXIT
# Only the definitions above the dispatch, so nothing runs.
awk '/^CMD="\$1"/{exit} {print}' "$ROOT/plugins/auro/skills/capture-standard/scripts/capture.sh" > "$LIB"
. "$LIB"
ok=0; bad=0
expect(){ # $1=name $2=expected substring $3=actual
  if printf '%s' "$3" | grep -qF -- "$2"; then ok=$((ok+1)); echo "  ok    $1"
  else bad=$((bad+1)); echo "  FAIL  $1"; echo "        wanted: $2"; echo "        got:    $3"; fi
}
run(){ ( "$@" ) 2>&1; }

rm -rf /tmp/capture_out /tmp/capture_corpus /tmp/capture_checks.tsv /tmp/capture_check_result.tsv
mkdir -p /tmp/capture_out /tmp/capture_corpus
printf '# CS-BUILD\n\n## Rules\n\n### CS-BUILD-001 — Pin the bundler target\n\nBody.\n\n- **Sources:** AB#1636704\n- **Since:** 2026-09-16\n' > /tmp/capture_corpus/build.md
cp /tmp/capture_corpus/build.md /tmp/capture_out/build.md
printf '\n### CS-BUILD-004 — Keep <slot> exports in the manifest\n\nBody.\n\n- **Sources:** AB#1668644\n- **Since:** 2026-10-22\n' >> /tmp/capture_out/build.md

echo "validate_checks"
expect "missing file is refused"        "NO_CHECKS_FILE"   "$(run validate_checks)"
: > /tmp/capture_checks.tsv
expect "empty file is a valid decision"  "check tickets to raise: 0" "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro-formkit\teslint.config.mjs\tan import rule can see it\n' > /tmp/capture_checks.tsv
expect "valid line passes"               "check tickets to raise: 1" "$(run validate_checks)"
printf 'CS-BUILD-004\treview\tauro-formkit\teslint.config.mjs\twhy\n' > /tmp/capture_checks.tsv
expect "unknown kind refused"            'kind "review"' "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro-formkit\n' > /tmp/capture_checks.tsv
expect "short line refused"              "expected 5 tab-separated fields, got 3" "$(run validate_checks)"
printf 'CS-BUILD-04\tlint\tauro-formkit\tx.js\twhy\n' > /tmp/capture_checks.tsv
expect "bad rule ID refused"             'bad rule ID "CS-BUILD-04"' "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro formkit\tx.js\twhy\n' > /tmp/capture_checks.tsv
expect "bad repo refused"                'bad target repo' "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro-formkit\tx`.js\twhy\n' > /tmp/capture_checks.tsv
expect "backtick path refused"           'contains a backtick' "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro-formkit\tx.js\t\n' > /tmp/capture_checks.tsv
expect "empty reason refused"            'no reason given' "$(run validate_checks)"
printf 'CS-BUILD-004\tlint\tauro-formkit\tx.js\twhy\nCS-BUILD-004\ttest\tauro-formkit\ty.js\twhy\n' > /tmp/capture_checks.tsv
expect "duplicate rule refused"          'CS-BUILD-004 is listed twice' "$(run validate_checks)"
printf 'CS-BUILD-009\tlint\tauro-formkit\tx.js\twhy\n' > /tmp/capture_checks.tsv
expect "unknown rule refused"            'CS-BUILD-009 is flagged machine-checkable but is in neither' "$(run validate_checks)"
printf 'CS-BUILD-001\tbuild\tauro-formkit\tpackage.json\twhy\n' > /tmp/capture_checks.tsv
expect "existing corpus rule accepted"   "check tickets to raise: 1" "$(run validate_checks)"

echo "rule_title"
expect "title from the proposal"         "Keep <slot> exports in the manifest" "$(rule_title CS-BUILD-004)"
expect "title from the corpus"           "Pin the bundler target" "$(rule_title CS-BUILD-001)"

echo "check_tickets_md / render_body"
: > /tmp/capture_check_result.tsv
expect "no tickets → fallback text"      "none raised" "$(check_tickets_md 'none raised')"
printf 'CS-BUILD-004\t1670001\tnew\nCS-BUILD-001\t1670002\texisting\n' > /tmp/capture_check_result.tsv
MD=$(check_tickets_md)
expect "ticket list links new"           '`CS-BUILD-004` → [AB#1670001](https://itsals.visualstudio.com/E_Retain_Content/_workitems/edit/1670001)' "$MD"
expect "ticket list marks existing"      '[AB#1670002](https://itsals.visualstudio.com/E_Retain_Content/_workitems/edit/1670002) (existing)' "$MD"
printf '**Review ticket:** {{REVIEW_TICKET}}\n\n## Machine-checkable\n**Check tickets:** {{CHECK_TICKETS}}\n' > /tmp/capture_pr_body.md
render_body "AB#1668644" "$MD"
OUT=$(cat /tmp/capture_pr_body.out)
expect "review placeholder filled"       "**Review ticket:** AB#1668644" "$OUT"
expect "checks placeholder filled"       "**Check tickets:** \`CS-BUILD-004\` → [AB#1670001]" "$OUT"
if grep -qF '{{' /tmp/capture_pr_body.out; then bad=$((bad+1)); echo "  FAIL  a placeholder survived"; else ok=$((ok+1)); echo "  ok    no placeholder survives"; fi

echo "classify_checks"
cat > /tmp/capture_t5a_batch.json <<'JSON'
{"value":[
 {"id":1,"fields":{"System.State":"Closed","System.Reason":"Acceptance tests pass","Microsoft.VSTS.Common.ClosedDate":"2026-11-02T10:00:00Z","System.Title":"Build a lint check for CS-BUILD-004 — x","System.Description":"Capture judged...\n\n**Planned check:** lint — auro-formkit `eslint.config.mjs`\n\nmore"}},
 {"id":2,"fields":{"System.State":"Closed","System.Reason":"Out of scope","System.Title":"Build a test check for CS-A11Y-001 — y"}},
 {"id":3,"fields":{"System.State":"Closed","System.Reason":"Moved to the backlog","System.Title":"Build a test check for CS-A11Y-002 — z"}},
 {"id":4,"fields":{"System.State":"New","System.Reason":"New","System.Title":"Build a helper check for CS-FORM-001 — w"}},
 {"id":5,"fields":{"System.State":"Closed","System.Reason":"Code complete and unit tests pass","System.Title":"no rule id here"}},
 {"id":6,"fields":{"System.State":"Resolved","System.Reason":"Code complete","System.Title":"Build a lint check for CS-FORM-002 — v"}},
 null
]}
JSON
C=$(classify_checks < /tmp/capture_t5a_batch.json)
row(){ printf '%s\n' "$C" | awk -F'\t' -v i="$1" '$1==i'; }
expect "Acceptance tests pass → shipped"          "$(printf '1\tshipped\tClosed\tAcceptance tests pass\t2026-11-02\tCS-BUILD-004\tlint — auro-formkit `eslint.config.mjs`')" "$(row 1)"
expect "Out of scope → no-check"                  "$(printf '2\tno-check\tClosed\tOut of scope')" "$(row 2)"
expect "unknown close reason → unclear"           "$(printf '3\tunclear\tClosed\tMoved to the backlog')" "$(row 3)"
expect "New → open"                               "$(printf '4\topen\tNew')" "$(row 4)"
expect "Code complete → shipped, no rule → -"     "$(printf '5\tshipped\tClosed\tCode complete and unit tests pass\t\t-\t-')" "$(row 5)"
expect "Resolved → open"                          "$(printf '6\topen\tResolved')" "$(row 6)"
expect "a null (omitted) item is skipped"         "6" "$(printf '%s\n' "$C" | grep -c .)"
rm -f /tmp/capture_t5a_batch.json

echo "require_work_evidence"
# Stub the ADO history lookup: ticket 1 was worked on, ticket 5 jumped New → Closed, 9 is unreadable.
worked_on(){ case "$1" in 1) return 0 ;; 9) return 2 ;; *) return 1 ;; esac; }
printf '%s\n' "$C" > /tmp/capture_check_tickets.tsv
MSG=$(require_work_evidence); RC=$?
C2=$(cat /tmp/capture_check_tickets.tsv)
row2(){ printf '%s\n' "$C2" | awk -F'\t' -v i="$1" '$1==i'; }
expect "worked-on shipped ticket stays shipped"   "$(printf '1\tshipped\tClosed\tAcceptance tests pass\t2026-11-02\tCS-BUILD-004\tlint — auro-formkit `eslint.config.mjs`')" "$(row2 1)"
expect "New → Closed as done becomes unclear"     "$(printf '5\tunclear\tClosed\tCode complete and unit tests pass\t\t-\t-')" "$(row2 5)"
expect "the downgrade is explained"               "AB#5 was closed as done without ever being Committed, Active or Resolved" "$MSG"
expect "non-shipped rows are untouched"           "$(printf '2\tno-check\tClosed\tOut of scope')" "$(row2 2)"
expect "an empty closed-date field survives"      "7" "$(printf '%s\n' "$C2" | awk -F'\t' '$1==5{print NF}')"
printf '9\tshipped\tClosed\tAcceptance tests pass\t2026-11-02\tCS-X-001\t-\n' > /tmp/capture_check_tickets.tsv
require_work_evidence >/dev/null; RC=$?
expect "unreadable history fails the step"        "1" "$RC"

echo "create_check_ticket reuse"
# Stub ADO: the lookup finds ticket 1670009. The query must treat as open what classify_checks calls
# open, so a Resolved ticket is reused rather than filed a second time.
ado_curl(){ while [ $# -gt 0 ]; do [ "$1" = "-o" ] && printf '{"workItems":[{"id":1670009}]}' > "$2"; shift; done; printf 200; }
OUT=$(create_check_ticket CS-BUILD-004 lint auro-formkit x.js why 1668644 https://example.test/pr/1)
expect "a found ticket is reused"                 "$(printf '1670009\texisting')" "$OUT"
expect "the lookup excludes only closed states"   "NOT IN ('Closed', 'Removed', 'Rejected')" "$(cat /tmp/capture_check_query.json)"

echo "raise_check_tickets"
# Stub the per-rule call; the file's last line has no trailing newline, as the Write tool may leave it.
create_check_ticket(){ case "$1" in CS-BUILD-004) printf '1670101\tnew\n' ;; *) printf '1670102\tnew\n' ;; esac; }
printf 'CS-BUILD-004\tlint\tauro-formkit\tx.js\twhy\nCS-BUILD-001\tbuild\tauro-formkit\tpackage.json\twhy' > /tmp/capture_checks.tsv
expect "count includes the unterminated line"     "check tickets to raise: 2" "$(run validate_checks)"
OUT=$(ADO_PAT=offline raise_check_tickets 1668644 https://example.test/pr/1)
expect "the unterminated last line is raised"     "AB#1670102 CS-BUILD-001 (new)" "$OUT"
expect "every counted line is raised"             "2" "$(grep -c . /tmp/capture_check_result.tsv)"
rm -f /tmp/capture_checks.log /tmp/capture_check_query.json /tmp/capture_check_found.json
echo
echo "offline: $ok passed, $bad failed"
[ "$bad" -eq 0 ]
