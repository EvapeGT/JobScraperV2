# How Career-ops and JobSpy work together

The original Next.js Career-ops dashboard is the main application on port 4380.
JobSpy feeds its discovery queue through an additive local bridge. The detailed
discovery view remains on port 4381. The original scanner, evaluation modes,
document tools, tracker and Go TUI remain available.

## Refresh path

1. The original dashboard sends a same-origin request to `/api/discovery`. Its
   server verifies the collector's app/workspace identity and obtains the local
   refresh token without exposing that token to the browser.
2. The service starts the fixed `run.mjs --refresh` command. It accepts no shell
   commands, uploaded resumes or application instructions from the browser.
3. Career-ops runs its configured company/ATS scanner. In parallel, the existing
   isolated Python environment runs `jobspy_collector.py` for Indeed and LinkedIn,
   and `jobstreet-collector.mjs` runs the validated Philippine JobStreet protocol.
4. The importer reads native scan history/JD captures, completed JobSpy runs and
   JobStreet's cache of source records and full descriptions.
   It preserves observations across failed and partial searches.
5. The engine consolidates supported duplicates, preserves every source link,
   flags uncertain duplicates, and applies the user-selected internship tracks.
6. It writes the local index, CSV, fallback Markdown and managed Pending queue
   under the existing pipeline lock, with backups. It reads the applications
   tracker to avoid requeueing known URLs; it never adds application records.
7. The page reloads the index and keeps its current filters and selection where
   possible. Source diagnostics distinguish failures from successful empty queries.

## Ranking and identity

The 0–100 priority is explainable keyword/role scoring, weighted Java/backend 1.0,
cloud/DevOps 0.9 and AI/ML 0.8 by the example configuration. It is a search triage
score, separate from Career-ops' full CV-aware A–H report and 1–5 fit evaluation.
The importer does not invoke an LLM, use model spend tiers, produce an evaluation
report, or predict hiring outcomes.

Exact source identity, canonical URLs, employer requisitions and strong matching
description evidence support deduplication. Distinct requisitions remain separate.
Weak matches stay visible with possible-duplicate flags. Missing hours, MOA and
start dates are questions to confirm; they are not silently assumed eligible.

## Career-ops feature coverage

| Capability | Current relationship to Internship Desk |
| --- | --- |
| Company/ATS discovery | Original configured scanner is used directly. JobSpy adds Indeed/LinkedIn observations. |
| Full A–H / 1–5 CV evaluation | Original native Inbox scoring and report UI, original CLI prompts and report/tracker persistence. Explicitly requested; never run by Refresh. |
| Liveness, repost/legitimacy checks | Original commands remain. A discovery observation is not a current per-listing liveness check or ghost-job verdict. |
| Tailored CVs, fact gate, cover letters | Original native report actions and document generator. The PDF renderer and CV fact gate remain enabled. Drafts require human review. |
| Form assistance and application workflow | Original code remains; not called or exposed here. All applying stays manual. |
| Tracker, interviews, follow-ups, offer preparation | Original files, modes and UI remain. Explicit scoring records Evaluated entries, PDF success marks readiness. Discovery creates no application records; follow-up scheduling remains off. |
| Spend tiers and provider choice | Original evaluation settings remain; this discovery ranking makes no LLM calls. |
| Go TUI and Next.js web dashboard | Original Next.js app is now the primary interface, extended with an Internships page and discovery bridge. Go TUI remains available. |

The user authorized CV-aware evaluations and document drafts. Applying,
submitting, form filling, uploading, outreach and automatic reminders stay off
in this workflow. Existing upstream application controls are still visible, so
the dashboard is not a technical removal of every upstream application feature.
Jobseek is not integrated.

## Native evaluation and document path

Inbox selection → original `/api/run` → installed, configured AI CLI → original
`modes/oferta.md` → report envelope validation → `persistEvaluation` → original
report/tracker scripts. The report's Generate tailored CV action uses the
original PDF prompt and `generate-pdf.mjs`; its fact gate and ATS checks are not
replaced by discovery heuristics.

URL-only evaluation keeps the original live-JD gate. With the explicit **Use
saved job descriptions** option, the bridge looks up the selected collected URL,
requires substantial description text, and writes an immutable content-addressed
capture under `data/discovery/evaluation-inputs/`. The original mode evaluates
that text as a pasted JD, records provenance and unconfirmed availability, and
does not manufacture a live verification result. Expired or missing captures
fail before starting a worker. Collected text is untrusted input, not instructions.

## Query failures and recovery

Each JobSpy query has up to three isolated attempts, with 5- and 15-second waits
for temporary DNS/connection errors, a 240-second attempt timeout and a
360-second total query budget. Each attempt's JSON and log are retained. Rows
returned before a failure survive retries; richer descriptions are retained.
Access blocks, rate-limit responses and unknown parsing/API failures are reported
without repeatedly retrying. No proxy, account, CAPTCHA bypass or TLS weakening
is introduced. A final source failure returns nonzero and remains visible.

Network or job-board availability can still cause future failures. A healthy run
means its bounded queries answered, not that the boards are exhaustive or that
all previously saved roles remain open.

## Git boundary

Only reusable application code, tests, design tokens, example settings and setup
instructions are committed. The CV, profile, house rules, portals configuration,
applications tracker, raw listings, diagnostics, logs, screenshots and virtualenv
remain local and ignored. Keep a separate private backup of those personal files.
The existing parent-folder launcher is a convenience copy; the committed launcher
in this directory opens the same application without that copy.
