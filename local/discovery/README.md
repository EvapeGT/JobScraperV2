# Internship Desk: Career-ops + JobStreet + JobSpy

The original Career-ops dashboard is the main workspace. JobSpy adds discovery
results to its inbox; user-requested evaluations and resume drafts use the
original Career-ops engines. Applications, uploads and outreach stay manual.

## Launch and refresh

From the Career-ops repository, run `node local/discovery/launch.mjs`, or
double-click `Start Internship Desk.cmd` in this directory. Both open
http://127.0.0.1:4380/internships. An existing parent-folder launcher opens the same app.
Both servers and the dashboard-to-collector connection are checked before the
launcher reports ready. The launcher window stays open to show the result; closing
it after startup leaves the servers running. Run it again after restarting Windows.
Open **Internships** and press **Refresh Career-ops + JobSpy** to run the company/ATS scanner, JobStreet and JobSpy
in parallel, then merge, deduplicate and rank. Saved results remain visible during
the search and across failures. The launcher reuses an already running server.

## Current discovery coverage

JobStreet Philippines uses its public search and read-only description protocol,
validated against Freehire; see `FREEHIRE-NOTICE.txt`. Searches are newest-first,
100 records per page, up to 10 pages per query. A page cap, source refusal or
incomplete response is reported as partial rather than a successful empty search.
Relevant descriptions are fetched once and cached in `data/discovery/jobstreet/cache.json`.
The default per-refresh description budget is 100 in the user configuration.
No login, proxy, challenge solving or automatic retry of access blocks is used.

JobSpy requests 100 Indeed results per query and 50 LinkedIn results per query.
Worker-scoped adapters request Indeed `sort: DATE` and LinkedIn `sortBy=DD` without
editing installed packages. Broader developer/backend/cloud/OJT terms complement
explicit Java searches. The default plan runs 7 Indeed and 3 LinkedIn searches,
down from 9 and 5 after comparing overlap and qualifying-role coverage. Indeed's
broad `software intern` query covers the last 30 days to retain recent generic
titles without consuming its budget on older noise. Developer, backend, Java,
cloud, DevOps and IT OJT searches have no age cutoff. A further unrestricted
`software engineering intern` fallback runs only if the recent broad query hits
its cap (at most 11 searches overall); otherwise it is recorded as unrun.
LinkedIn uses Java, DevOps and platform engineering terms. Isolated cloud/SRE
and software-developer variants did not add qualifying roles beyond that union;
redundant searches and the capped broad software/cloud searches were removed.
The legacy `--springboot-only` diagnostic remains available.
Employment-type facets are not a hard filter:
the ranking engine requires internship/OJT evidence in the title or description.
Result-budget limits remain visible in source diagnostics.
Per-query windows and the actual per-site plans are saved in each configuration
receipt. Overlapping query results use the existing richer-text merge and retain
all query provenance and description capture dates, rather than keeping a sparse
first copy. The query delays, budgets, retries and access-refusal behavior are
unchanged. An access/rate refusal also stops the board's remaining queries rather
than continuing to request other terms. This is bounded discovery, not complete
board coverage.

The active shortlist is Java/backend and cloud/DevOps. AI-only records remain in
the saved index as excluded history. Newest sorting uses source posting dates,
not the date an old listing was seen again. Tracker statuses are read-only;
verified cross-posts inherit their existing status in the derived discovery view
and are not requeued. Uncertain cross-posts are flagged rather than silently merged.
Generic technical titles can reach manual review from demonstrated Java/API or
cloud deployment/pipeline duties in their descriptions. Mixed MLOps roles require
actual operational duties to qualify under cloud/DevOps; company technology
boilerplate does not qualify. Explicit OJT job classifications are recognized.
Senior/lead jobs do not become internships because a company describes its intern
program. Philippine remote roles outside NCR need eligibility review; onsite
placements outside the target area remain excluded.

The Pipeline inbox joins exact canonical/source/application URLs against this
same saved index. `postedAt` is an actual source posting date;
`firstDiscoveredAt` is the first scraper observation, displayed separately.
Dates use Manila calendar days. A canonical employer posting date takes priority;
otherwise the latest source posting/reposting date is used. Source badges retain
their own dates and original links, and employer platforms are separate links.
Exact dates are accessible on the relative-date label. Unknown dates display
“Posting date unavailable”. Sorting puts dated jobs newest first, then undated
jobs by first discovery newest first, with URL/record identity as the final tie.
The 24h/3d/etc. filters use posting dates only and exclude unknown dates.

Each live refresh writes `source_audit` in `data/discovery/source-status.json`:
raw query hits (including query overlap), distinct retrieved source records,
canonical roles surviving the active filters, already tracked roles, new source
records, and genuinely new qualifying roles. Per-source qualifying counts can
overlap because one canonical role may appear on several boards. Caps, source
ordering inversions and missing metadata are reported without increasing traffic.
Cached rebuilds preserve the last live audit instead of presenting history as a
new live search. Personal Pending notes survive managed-row regeneration; notes
for a role leaving the queue remain as prose without requeueing that role.

In **Pipeline → Inbox**, save a role, choose **Full evaluation**, then score it.
For collected descriptions on sites the AI cannot read, explicitly select
**Use saved job descriptions**. The report records the original URL and capture
date and labels availability unconfirmed. It does not claim the listing is live.
The report offers the original 1–5 CV-aware evaluation, ATS keyword coverage,
interview preparation, tailored CV/PDF and cover-letter controls. Document drafts
retain the original CV fact gate. Review them before any manual application.

The **CV** editor maintains `cv.md`, the broad master evidence bank. **CV Studio**
edits one role's tailored document. Generation reads the master CV, selected
profile and role report; it selects relevant evidence rather than including
everything. For a clean one-page default, set `cv.template: harvard`,
`cv.max_pages: 1` and `cv.strict_pages: true` in your profile. The original
renderer checks the actual page count and rejects overflow before replacing the
final PDF. Tailoring and fact checks remain active.
The Harvard-style template opens with education and skills, without a summary or
competency grid. Keep personal section/project retention preferences in
`modes/_custom.md`; both web and CLI tailoring honor those rules. A pipeline
evaluation produces the fit report; its subsequent CV generation uses this
default while selecting supported evidence for that specific role.

The detailed discovery view remains at http://127.0.0.1:4381, linked from
Internships. `node local/discovery/launch.mjs --discovery-only` opens only that view.
Refresh itself never invokes AI scoring or document generation.

Evaluation workers currently belong to their browser's streaming request.
In-app navigation keeps the request alive; a hard reload or tab close can cancel
it. Active workers install a leave-page warning. This is not background-job
resumption: confirming the reload can still interrupt the run. Worker-card
history is browser-local, while completed and failed diagnostic logs are saved
under `.career-ops-web/runs/` for inspection across browsers. An interrupted
running entry is logged on the next load and is never automatically retried.

CLI alternatives:

```powershell
node local/discovery/run.mjs --refresh
node local/discovery/run.mjs
node local/discovery/run.mjs --dry-run
```

The second command rebuilds from saved inputs; the third previews counts without
writing. `npm run scan` alone remains the original native scanner.

## Dependencies and configuration

The working local installation already has these dependencies. For another
checkout, use Node 22.13+ and Python 3.12+; from the Career-ops repository:

```powershell
npm install --ignore-scripts --no-audit --no-fund
cd web
npm ci --no-audit --no-fund
cd ..
python -m venv ../experiments/jobspy/.venv
../experiments/jobspy/.venv/Scripts/python.exe -m pip install -r local/discovery/jobspy-requirements.txt
```

Copy `local/discovery/discovery.example.json` to `config/discovery.json` only if
that user configuration does not already exist. Restore/configure your own
`config/profile.yml` and `portals.yml` using Career-ops' normal setup. They and
the CV, trackers, results and virtualenv are intentionally not committed.
Select the installed AI CLI in the native dashboard's **Config** page. Its
configured provider processes requested evaluations and drafts. Install the PDF
browser with `node node_modules/playwright/cli.js install chromium --only-shell`
after setting `PLAYWRIGHT_BROWSERS_PATH` to `output/playwright-browsers` under this
repository; the native launcher supplies that path to the dashboard.
The Python path/output folder can be changed in `config/discovery.json`; relative
paths resolve from the Career-ops repository. No JobSpy reference checkout or
external `pilot.py` is needed after installing the pinned dependency.

Edit native sources in your user-layer `portals.yml`; JobSpy query definitions
live in `jobspy_collector.py`. Profile and discovery settings control preferences
and weights. Do not edit generated result files to change targeting.

## Components

- `engine.mjs`: conservative identity matching, explainable ranking and managed
  Pending-section rendering. Separate requisitions remain separate.
- `io.mjs`: native history/JD and JobSpy readers, report/CSV writers.
- `run.mjs`: fixed collector orchestration, locks, backups and atomic writes.
- `jobspy_collector.py`: isolated workers, bounded transport retries, attempt
  evidence, partial-result retention and truthful failure exit codes.
- `server.mjs`, `discovery-launch.mjs`, `web/`: detailed discovery interface on 4381.
- `launch.mjs`, `native-launch.mjs`: original dashboard on 4380 plus the collector.
- `../../web/src/lib/core/discovery.mjs`: fixed loopback bridge with workspace
  identity checks and server-side refresh token handling.
- `../../web/src/lib/core/saved-posting.mjs`: immutable saved-JD input adapter for
  the original evaluation mode's pasted-description branch.

User data resolves through the native data-root/profile/tracker helpers. Queue
writes use its lock and formatter. Discovery reads the applications tracker;
explicit native evaluations and PDF generation use the original tracker writers.
The 0–100 discovery priority is separate from the full A–H / 1–5 evaluation.
Importing, deduplication and ranking make no LLM calls.

See [INTEGRATION.md](INTEGRATION.md) for the data flow, Career-ops feature coverage,
retry limits, limitations and Git boundary.

## Verification

```powershell
node --test local/discovery/engine.test.mjs local/discovery/integration.test.mjs local/discovery/server.test.mjs
../experiments/jobspy/.venv/Scripts/python.exe -X utf8 local/discovery/jobspy_collector_test.py
```

HTTP tests need loopback access. Python tests simulate workers without contacting
job boards. Test the real Refresh button separately and inspect the completed
run's `source-status.json`, collector summary, attempt logs and tracker hash.
