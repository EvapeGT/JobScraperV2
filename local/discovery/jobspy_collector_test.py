"""Retry/retention tests with simulated workers; never contacts job boards."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("jobspy_collector.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
SCRATCH = Path(__file__).resolve().parents[2] / "output" / "discovery-tests"
SCRATCH.mkdir(parents=True, exist_ok=True)


class RetryTests(unittest.TestCase):
    def test_narrow_fallback_only_runs_if_the_broad_recent_search_hits_its_cap(self):
        for capped, status in ((False, 'answered'), (True, 'answered'), (False, 'partial_or_failed')):
            with self.subTest(capped=capped, status=status), tempfile.TemporaryDirectory(dir=SCRATCH) as folder, \
                 mock.patch.object(collector, 'run_query') as query, mock.patch.object(collector.time, 'sleep') as sleep, \
                 contextlib.redirect_stdout(io.StringIO()):
                query.side_effect = lambda site, term, *args: dict(site=site, query=term, status=status if term == 'software intern' else 'answered',
                    errors={'indeed': 'getaddrinfo failed'} if term == 'software intern' and status != 'answered' else {}, result_limit_reached=capped if term == 'software intern' else False)
                receipts = collector.site_lane('indeed', Path(folder), collector.QUERIES)
                self.assertEqual(len(receipts), 8 if capped else 7)
                self.assertEqual(sleep.call_args_list, [mock.call(3)] * (len(receipts) - 1))
                self.assertEqual(any(q['query'] == 'software engineering intern' for q in receipts), capped)

    def test_access_refusal_stops_remaining_queries_for_that_board(self):
        for message in ('status code 429', 'API error: RATE_LIMITED', 'Too many requests'):
            with self.subTest(message=message), tempfile.TemporaryDirectory(dir=SCRATCH) as folder, \
                 mock.patch.object(collector, 'run_query') as query, mock.patch.object(collector.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
                query.return_value = dict(site='indeed', query='software intern', status='partial_or_failed', errors={'indeed': message}, result_limit_reached=False)
                receipts = collector.site_lane('indeed', Path(folder), collector.QUERIES)
                self.assertEqual(len(receipts), 1)
                self.assertEqual(query.call_count, 1)
                sleep.assert_not_called()

    def test_recent_broad_search_does_not_age_limit_the_targeted_long_tail(self):
        frame = SimpleNamespace(attrs={}, to_json=lambda **kwargs: '[]')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder, mock.patch('jobspy.scrape_jobs', return_value=frame) as scrape, \
             mock.patch.object(collector, 'install_newest_adapters'), contextlib.redirect_stdout(io.StringIO()):
            collector.worker('indeed', 'software intern', Path(folder) / 'recent.json')
            self.assertEqual(scrape.call_args.kwargs['hours_old'], 720)
            collector.worker('indeed', 'software engineering intern', Path(folder) / 'technical.json')
            self.assertNotIn('hours_old', scrape.call_args.kwargs)
            collector.worker('linkedin', 'platform engineering intern', Path(folder) / 'platform.json')
            self.assertNotIn('hours_old', scrape.call_args.kwargs)
        self.assertEqual(len(collector.QUERIES) + len(collector.LINKEDIN_QUERIES), 11)
        self.assertEqual(collector.RESULTS_WANTED, {'indeed': 100, 'linkedin': 50})

    def test_overlapping_queries_keep_richer_descriptions_capture_dates_and_all_queries(self):
        first = dict(site='indeed', id='one', description='', discovery_query='software intern', observed_at='2026-11-01T01:00:00+08:00')
        second = dict(site='indeed', id='one', description='x' * 200, discovery_query='developer intern', description_captured_at='2026-11-01T01:03:00+08:00')
        third = dict(site='indeed', id='one', description='short', discovery_query='Java intern', description_captured_at='2026-11-01T01:05:00+08:00')
        merged = collector.merge_jobs([], [first, second, third])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['description'], second['description'])
        self.assertEqual(merged[0]['description_captured_at'], second['description_captured_at'])
        self.assertEqual(merged[0]['discovery_queries'], ['software intern', 'developer intern', 'Java intern'])

    def test_live_response_date_and_description_quality_are_recorded(self):
        rows = [dict(date_posted='2026-10-29', description='x' * 150), dict(date_posted='2026-10-30', description=''), dict(date_posted=None)]
        frame = SimpleNamespace(attrs={}, to_json=lambda **kwargs: json.dumps(rows))
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder, mock.patch('jobspy.scrape_jobs', return_value=frame), \
             mock.patch.object(collector, 'install_newest_adapters'), contextlib.redirect_stdout(io.StringIO()):
            target = Path(folder) / 'result.json'
            self.assertEqual(collector.worker('linkedin', 'software intern', target), 0)
            data = json.loads(target.read_text(encoding='utf-8'))
            self.assertEqual(data['date_order_inversions'], 1)
            self.assertEqual(data['missing_dates'], 1)
            self.assertEqual(data['missing_descriptions'], 2)

    def test_newest_adapters_use_real_transport_fields_without_network(self):
        import jobspy
        from jobspy.model import Site, ScraperInput
        with mock.patch.dict(jobspy.SCRAPER_MAPPING):
            collector.install_newest_adapters()
            indeed = jobspy.SCRAPER_MAPPING[Site.INDEED]()
            indeed.scraper_input = ScraperInput(site_name=['indeed'], search_term='Java intern')
            self.assertIn('sort: DATE', indeed._build_query('', None))
            linkedin = jobspy.SCRAPER_MAPPING[Site.LINKEDIN]()
            linkedin.scraper_input = ScraperInput(site_name=['linkedin'], search_term='DevOps intern')
            self.assertEqual(linkedin._search_params()['sortBy'], 'DD')

    def test_worker_requests_more_than_15_without_a_strict_job_type_filter(self):
        frame = SimpleNamespace(attrs={}, to_json=lambda **kwargs: '[]')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder, \
             mock.patch('jobspy.scrape_jobs', return_value=frame) as scrape, \
             mock.patch.object(collector, 'install_newest_adapters'), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(collector.worker('indeed', 'developer intern', Path(folder)/'result.json'), 0)
        options = scrape.call_args.kwargs
        self.assertEqual(options['results_wanted'], 100)
        self.assertNotIn('job_type', options)

    def simulate(self, responses, *, clock=None, run=None):
        calls, delays = [], []
        def worker(command, **kwargs):
            calls.append(kwargs["timeout"])
            response = responses[len(calls) - 1]
            if isinstance(response, Exception):
                raise response
            destination = Path(command[command.index("--result") + 1])
            collector.write_json(destination, {"site": "linkedin", "query": "Java intern",
                "status": "partial_or_failed" if response.get("errors") else "answered",
                "warnings": {}, "jobs": [], **response})
            return SimpleNamespace(returncode=2 if response.get("errors") else 0)
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder, contextlib.redirect_stdout(io.StringIO()):
            result = collector.run_query("linkedin", "Java intern", Path(folder), "linkedin-01",
                run_worker=run or worker, sleep=delays.append, clock=clock or (lambda: 0))
            saved = json.loads(Path(result["result"]).read_text(encoding="utf-8"))
            attempt_files = list(Path(folder).glob("*.attempt-*.json"))
        return result, saved, calls, delays, len(attempt_files)

    def test_dns_failure_recovers_and_keeps_attempt_evidence(self):
        result, saved, calls, delays, files = self.simulate([
            {"errors": {"linkedin": "NameResolutionError: getaddrinfo failed"}},
            {"errors": {}, "jobs": [{"id": "li-1", "site": "linkedin"}]}])
        self.assertEqual(result["status"], "answered")
        self.assertEqual(result["exit_code"], 0)
        self.assertTrue(result["recovered_after_retry"])
        self.assertEqual(saved["attempts"][0]["failure_kind"], "dns")
        self.assertEqual((len(calls), delays, files), (2, [5], 2))

    def test_connection_failure_keeps_partial_rows_and_richer_descriptions(self):
        result, saved, *_ = self.simulate([
            {"errors": {"linkedin": "Connection aborted: RemoteDisconnected"}, "jobs": [
                {"id": "li-1", "site": "linkedin", "description": "A useful long description"},
                {"id": "li-2", "site": "linkedin"}]},
            {"errors": {}, "jobs": [{"id": "li-1", "site": "linkedin", "description": "short"},
                                      {"id": "li-3", "site": "linkedin"}]}])
        self.assertEqual(result["count"], 3)
        self.assertEqual(saved["jobs"][0]["description"], "A useful long description")
        self.assertEqual(saved["errors"], {})

    def test_exhausted_retries_report_failure_and_retain_partial_rows(self):
        bad = {"errors": {"linkedin": "Failed to establish a new connection: [WinError 10051]"},
               "jobs": [{"id": "li-1", "site": "linkedin"}]}
        result, saved, calls, delays, files = self.simulate([bad, bad, bad])
        self.assertEqual(result["exit_code"], 2)
        self.assertEqual(result["status"], "partial_or_failed")
        self.assertFalse(result["recovered_after_retry"])
        self.assertEqual((result["count"], len(calls), delays, files), (1, 3, [5, 15], 3))
        self.assertTrue(saved["errors"])

    def test_access_blocks_and_unknown_errors_are_not_retried(self):
        for message in ["response status code 403 (blocked)", "response status code 429", "unexpected API schema"]:
            with self.subTest(message=message):
                result, _, calls, delays, _ = self.simulate([{"errors": {"linkedin": message}}])
                self.assertEqual((len(calls), delays, result["exit_code"]), (1, [], 2))

    def test_missing_worker_output_is_a_failure_not_an_empty_success(self):
        def no_output(*args, **kwargs):
            return SimpleNamespace(returncode=0)
        result, saved, *_ = self.simulate([], run=no_output)
        self.assertEqual(result["exit_code"], 2)
        self.assertTrue(saved["errors"])
        self.assertEqual(len(saved["attempts"]), 1)

    def test_timeout_retry_respects_total_query_budget(self):
        elapsed, calls = [0], []
        def timeout(command, **kwargs):
            calls.append(kwargs["timeout"])
            elapsed[0] += kwargs["timeout"]
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder, contextlib.redirect_stdout(io.StringIO()):
            result = collector.run_query("linkedin", "Java intern", Path(folder), "linkedin-01",
                run_worker=timeout, sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds),
                clock=lambda: elapsed[0])
        self.assertEqual(result["exit_code"], 2)
        self.assertEqual(calls, [240, 115])
        self.assertEqual(elapsed[0], 360)

    def test_parent_exit_and_summary_reflect_unresolved_query_errors(self):
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory(dir=SCRATCH) as folder:
                def lane(site, out, queries):
                    result = out / f"{site}-01.json"
                    collector.write_json(result, {"jobs": [{"site": site, "id": f"{site}-1"}]})
                    errors = {site: "getaddrinfo failed"} if failed and site == "linkedin" else {}
                    return [dict(site=site, query=queries[0], count=1, errors=errors,
                        attempts=[{}], recovered_after_retry=False, result=str(result))]
                with mock.patch.object(collector, "site_lane", side_effect=lane), \
                     mock.patch.object(collector.importlib.metadata, "version", return_value="test"), \
                     mock.patch.object(collector.sys, "argv", ["collector", "--output-root", folder]), \
                     contextlib.redirect_stdout(io.StringIO()):
                    code = collector.main()
                latest = Path(folder, "latest-run.txt").read_text(encoding="utf-8")
                summary = json.loads(Path(latest, "summary.json").read_text(encoding="utf-8"))
                self.assertEqual(code, 2 if failed else 0)
                self.assertEqual(summary["queries_with_errors"], 1 if failed else 0)
                self.assertEqual(summary["unique_listings"], 2)


if __name__ == "__main__":
    unittest.main()
