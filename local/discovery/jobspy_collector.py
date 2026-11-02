"""Bounded JobSpy discovery collector; never applies or submits user data."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parents[3] / "experiments" / "jobspy"
MAX_ATTEMPTS = 3
ATTEMPT_TIMEOUT_SECONDS = 240
QUERY_BUDGET_SECONDS = 360
RETRY_DELAYS = (5, 15)
SPRING_BOOT_QUERIES = ["Spring Boot intern", "Java Spring Boot internship"]
# A recent broad query retains generic titles; the narrower role queries have
# no age cutoff and can find older technical openings beyond that window.
QUERIES = ["software intern", "software engineering intern", "developer intern", "backend intern", "Java intern", "cloud intern", "DevOps intern", "IT OJT"]
LINKEDIN_QUERIES = ["Java intern", "DevOps intern", "platform engineering intern"]
QUERY_OPTIONS = {"indeed": {"software intern": {"hours_old": 30 * 24}}}
RESULTS_WANTED = {"indeed": 100, "linkedin": 50}
SITES = ["indeed", "linkedin"]
LOCATION = "Metro Manila, Philippines"


def now() -> str:
    return datetime.now(ZoneInfo("Asia/Manila")).isoformat()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def failure_kind(data: dict) -> str | None:
    """Retry temporary transport failures; leave access blocks and code errors visible."""
    if not data.get("errors"):
        return None
    message = json.dumps(data["errors"]).lower()
    if any(word in message for word in ("status code 403", "status code 401", "captcha", "blocked", "status code 429", "rate_limited", "rate limit", "too many requests")):
        return "access_or_rate_limit"
    if any(word in message for word in ("nameresolutionerror", "getaddrinfo", "failed to resolve", "name resolution")):
        return "dns"
    if any(word in message for word in ("timed out", "timeout", "remotedisconnected", "connection aborted", "connection reset", "newconnectionerror", "unreachable network", "winerror 10051", "winerror 10054", "failed to establish a new connection", "status code 408", "status code 500", "status code 502", "status code 503", "status code 504")):
        return "connection"
    return "source_or_worker"


def merge_jobs(previous: list[dict], incoming: list[dict]) -> list[dict]:
    """Retain useful partial rows and prefer richer data on a later attempt."""
    merged = {}
    for row in [*previous, *incoming]:
        key = (row.get("site"), row.get("id") or row.get("job_url") or
               json.dumps([row.get("company"), row.get("title"), row.get("location")]))
        old = merged.get(key, {})
        next_row = {**old, **{name: value for name, value in row.items() if value is not None and value != ""}}
        if len(str(old.get("description") or "")) > len(str(row.get("description") or "")):
            next_row["description"] = old["description"]
            if old.get("description_captured_at"):
                next_row["description_captured_at"] = old["description_captured_at"]
        next_row["discovery_queries"] = list(dict.fromkeys([
            *old.get("discovery_queries", []), *row.get("discovery_queries", []),
            *[q for q in (old.get("discovery_query"), row.get("discovery_query")) if q],
        ]))
        merged[key] = next_row
    return list(merged.values())


def install_newest_adapters():
    """Scope transport overrides to this worker; never modify installed JobSpy."""
    import jobspy
    from jobspy.indeed import Indeed
    from jobspy.linkedin import LinkedIn
    from jobspy.model import Site

    class NewestIndeed(Indeed):
        def _build_query(self, filters, cursor):
            original = super()._build_query(filters, cursor)
            if "sort: RELEVANCE" not in original:
                raise ValueError("JobSpy changed its Indeed query; newest-first adapter needs review")
            return original.replace("sort: RELEVANCE", "sort: DATE", 1)

    class NewestLinkedIn(LinkedIn):
        def _search_params(self):
            return {**super()._search_params(), "sortBy": "DD"}

    jobspy.SCRAPER_MAPPING[Site.INDEED] = NewestIndeed
    jobspy.SCRAPER_MAPPING[Site.LINKEDIN] = NewestLinkedIn


def worker(site: str, query: str, result_path: Path) -> int:
    from jobspy import scrape_jobs

    start = now()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    options = dict(site_name=[site], search_term=query, location=LOCATION,
                   country_indeed="philippines", results_wanted=RESULTS_WANTED[site], fetch_description=True,
                   description_format="plain", verbose=2)
    options.update(QUERY_OPTIONS.get(site, {}).get(query, {}))
    # Some real internships are labelled Full time or Contract. The importer
    # verifies internship evidence instead of requiring the board's type facet.
    try:
        install_newest_adapters()
        frame = scrape_jobs(**options)
        rows = json.loads(frame.to_json(orient="records", date_format="iso", force_ascii=False))
        errors, warnings = frame.attrs.get("errors", {}), frame.attrs.get("warnings", {})
        data = dict(site=site, query=query, started_at=start, finished_at=now(),
                    options={**options, "requested_sort": "newest"}, errors=errors, warnings=warnings, jobs=rows,
                    result_limit_reached=len(rows) >= RESULTS_WANTED[site],
                    status="partial_or_failed" if errors else "answered")
        for row in rows:
            row["discovery_query"] = query
            row["observed_at"] = data["finished_at"]
            if row.get("description"):
                row["description_captured_at"] = data["finished_at"]
        dated = [str(row["date_posted"]) for row in rows if row.get("date_posted")]
        data["missing_dates"] = len(rows) - len(dated)
        data["missing_descriptions"] = sum(len(str(row.get("description") or "").strip()) < 100 for row in rows)
        data["date_order_inversions"] = sum(current > previous for previous, current in zip(dated, dated[1:]))
        write_json(result_path, data)
        print(json.dumps({"site": site, "query": query, "count": len(rows), "errors": errors}), flush=True)
        return 2 if errors else 0
    except Exception as exc:
        write_json(result_path, dict(site=site, query=query, started_at=start, finished_at=now(),
                                    options=options, errors={site: str(exc)}, warnings={}, jobs=[], status="exception"))
        logging.exception("Search failed")
        return 2


def run_query(site: str, query: str, out: Path, stem: str, *,
              run_worker=None, sleep=None, clock=None) -> dict:
    run_worker = run_worker or subprocess.run
    sleep = sleep or time.sleep
    clock = clock or time.monotonic
    began, started, attempts, retained = clock(), now(), [], []
    final = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        remaining = QUERY_BUDGET_SECONDS - (clock() - began)
        if remaining <= 0:
            break
        result_path = out / f"{stem}.attempt-{attempt:02d}.json"
        log_path = out / f"{stem}.attempt-{attempt:02d}.log"
        command = [sys.executable, "-X", "utf8", "-u", str(Path(__file__).resolve()),
                   "--worker", "--site", site, "--query", query, "--result", str(result_path),
                   "--results-wanted", str(RESULTS_WANTED["indeed"]),
                   "--linkedin-results-wanted", str(RESULTS_WANTED["linkedin"])]
        attempt_started = now()
        process_options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        with log_path.open("w", encoding="utf-8") as log:
            try:
                done = run_worker(command, stdout=log, stderr=subprocess.STDOUT,
                                  timeout=min(ATTEMPT_TIMEOUT_SECONDS, remaining), check=False, **process_options)
                code, error = done.returncode, None
            except subprocess.TimeoutExpired:
                code, error = None, "Worker timed out before the bounded query deadline"
            except OSError as exc:
                code, error = None, f"Worker could not start: {exc}"
        try:
            data = json.loads(result_path.read_text(encoding="utf-8"))
            if not isinstance(data.get("jobs"), list):
                raise ValueError("Worker did not return a jobs array")
        except (OSError, ValueError) as exc:
            data = dict(site=site, query=query, started_at=attempt_started, finished_at=now(),
                        status="timeout" if error and "timed out" in error else "worker_failed",
                        errors={site: error or f"Worker output could not be read: {exc}"}, warnings={}, jobs=[])
            write_json(result_path, data)
        if code != 0 and not data.get("errors"):
            data["errors"] = {site: error or f"Worker exited with code {code}"}
            write_json(result_path, data)
        retained = merge_jobs(retained, data["jobs"])
        kind = failure_kind(data)
        attempts.append(dict(number=attempt, started_at=attempt_started, finished_at=now(),
                             count=len(data["jobs"]), status=data["status"], errors=data.get("errors", {}),
                             warnings=data.get("warnings", {}), exit_code=code, failure_kind=kind,
                             result=str(result_path), log=str(log_path)))
        final = data
        if not data.get("errors") or kind not in ("dns", "connection") or attempt == MAX_ATTEMPTS:
            break
        delay = RETRY_DELAYS[attempt - 1]
        if clock() - began + delay >= QUERY_BUDGET_SECONDS:
            break
        print(json.dumps({"event": "query_retry", "site": site, "query": query,
                          "attempt": attempt, "failure_kind": kind, "retry_in_seconds": delay}), flush=True)
        sleep(delay)
    assert final is not None
    failed = bool(final.get("errors"))
    final = {**final, "started_at": started, "finished_at": now(), "jobs": retained,
             "status": "partial_or_failed" if failed else "answered", "attempts": attempts,
             "recovered_after_retry": len(attempts) > 1 and not failed}
    canonical = out / f"{stem}.json"
    write_json(canonical, final)
    return dict(site=site, query=query, count=len(retained), errors=final.get("errors", {}),
                missing_dates=final.get("missing_dates"), missing_descriptions=final.get("missing_descriptions"),
                date_order_inversions=final.get("date_order_inversions"),
                result_limit_reached=final.get("result_limit_reached", False),
                warnings=final.get("warnings", {}), exit_code=2 if failed else 0, status=final["status"],
                attempts=attempts, recovered_after_retry=final["recovered_after_retry"],
                result=str(canonical), log=str(out / f"{stem}.attempt-{len(attempts):02d}.log"))


def site_lane(site: str, out: Path, queries: list[str]) -> list[dict]:
    summaries = []
    for index, query in enumerate(queries, 1):
        anchor = next((q for q in summaries if q['query'] == 'software intern'), None)
        if site == 'indeed' and query == 'software engineering intern' and anchor and not anchor.get('result_limit_reached'):
            print(json.dumps({'event': 'coverage_query_skipped', 'site': site, 'query': query,
                              'reason': 'Recent broad search did not reach cap; no additional engineering request'}), flush=True)
            continue
        if summaries:
            time.sleep(3)
        stem = f"{site}-{index:02d}"
        item = run_query(site, query, out, stem)
        summaries.append(item)
        print(json.dumps(item), flush=True)
        if failure_kind(item) == 'access_or_rate_limit':
            print(json.dumps({'event': 'site_lane_stopped', 'site': site, 'reason': 'Access/rate refusal; remaining queries were not requested'}), flush=True)
            break
    return summaries


def main(default_output_root: Path | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--site")
    parser.add_argument("--query")
    parser.add_argument("--result", type=Path)
    parser.add_argument("--results-wanted", type=int, default=100)
    parser.add_argument("--linkedin-results-wanted", type=int, default=50)
    parser.add_argument("--springboot-only", action="store_true", help="Run only the two explicit Spring Boot searches")
    parser.add_argument("--output-root", type=Path, default=default_output_root or DEFAULT_OUTPUT_ROOT)
    args = parser.parse_args()
    if not 16 <= args.results_wanted <= 500 or not 16 <= args.linkedin_results_wanted <= 200:
        parser.error("Result budgets must be 16–500 for Indeed and 16–200 for LinkedIn")
    RESULTS_WANTED.update(indeed=args.results_wanted, linkedin=args.linkedin_results_wanted)
    if args.worker:
        return worker(args.site, args.query, args.result)

    queries = SPRING_BOOT_QUERIES if args.springboot_only else QUERIES

    started = now()
    stamp = datetime.now(ZoneInfo("Asia/Manila")).strftime("%Y-%m-%d_%H%M%S_%f")
    base = args.output_root.resolve()
    out = base / "output" / stamp
    out.mkdir(parents=True, exist_ok=False)
    config = dict(started_at=started, location=LOCATION, country_indeed="philippines",
                  sites=SITES, queries=queries, results_per_query_per_site=dict(RESULTS_WANTED), requested_sort="newest",
                  queries_by_site={site: queries if site == "indeed" or args.springboot_only else LINKEDIN_QUERIES for site in SITES},
                  per_query_options=QUERY_OPTIONS if not args.springboot_only else {},
                  posting_age_filter=None, fetch_description=True, per_attempt_timeout_seconds=ATTEMPT_TIMEOUT_SECONDS,
                  max_attempts=MAX_ATTEMPTS, retry_delays_seconds=RETRY_DELAYS, query_budget_seconds=QUERY_BUDGET_SECONDS,
                  jobspy_version=importlib.metadata.version("python-jobspy"),
                  scope="Discovery only. No CV, credentials, accounts or submissions. Raw results are available to the authorized local importer.")
    write_json(out / "configuration.json", config)
    pointer = "latest-springboot-run.txt" if args.springboot_only else "latest-run.txt"
    (base / pointer).write_text(str(out), encoding="utf-8")
    summaries = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(site_lane, site, out, queries if site == "indeed" or args.springboot_only else LINKEDIN_QUERIES) for site in SITES]
        for future in as_completed(pending):
            summaries.extend(future.result())

    all_jobs = []
    for summary in summaries:
        all_jobs.extend(json.loads(Path(summary["result"]).read_text(encoding="utf-8"))["jobs"])
    unique = merge_jobs([], all_jobs)
    write_json(out / "all-results.json", all_jobs)
    write_json(out / "unique-results.json", unique)
    metadata = dict(**config, finished_at=now(), query_runs=summaries, raw_records=len(all_jobs),
                    unrun_queries=[dict(site=site, query=query) for site, queries in config['queries_by_site'].items() for query in queries
                                   if not any(q['site'] == site and q['query'] == query for q in summaries)],
                    unique_listings=len(unique),
                    per_site={site: sum(j.get("site") == site for j in unique) for site in SITES},
                    queries_with_errors=sum(bool(x["errors"]) for x in summaries),
                    queries_at_result_limit=sum(x.get("result_limit_reached", False) for x in summaries),
                    queries_retried=sum(len(x["attempts"]) > 1 for x in summaries),
                    queries_recovered=sum(x["recovered_after_retry"] for x in summaries))
    write_json(out / "summary.json", metadata)
    print(json.dumps({"output": str(out), "unique_listings": len(unique), "per_site": metadata["per_site"],
                      "queries_with_errors": metadata["queries_with_errors"],
                      "queries_recovered": metadata["queries_recovered"]}), flush=True)
    return 2 if metadata["queries_with_errors"] else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
