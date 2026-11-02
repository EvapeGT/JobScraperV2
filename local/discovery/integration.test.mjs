import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const code = fileURLToPath(new URL('../../', import.meta.url));
const entry = path.join(code, 'local/discovery/run.mjs');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };

test('A failed source refresh retains cached jobs, tracker/manual state and failure diagnostics across repeat imports', () => {
  const base = path.join(code, 'output/discovery-tests');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'retention-'));
  const project = path.join(root, 'jobspy');
  const sourceRun = path.join(project, 'output/cached');
  const data = path.join(root, 'data/discovery');
  const cached = { id: 'in-cached', site: 'indeed', job_url: 'https://ph.indeed.com/viewjob?jk=cached', company: 'Cached Employer',
    title: 'Java Backend Intern', location: 'Makati, Philippines', observed_at: '2026-10-29T10:00:00+08:00',
    description: 'Develop and test Java Spring Boot REST APIs and databases with a mentor. This internship accepts students.' };
  put(path.join(root, 'config/discovery.json'), JSON.stringify({ discovery_only: true, auto_apply: false, auto_outreach: false,
    jobspy: { project, python: path.join(root, 'intentionally-missing-python.exe'), timeout_ms: 5000 }, native_timeout_ms: 15000,
    role_weights: { java_backend: 1, cloud_devops: 0.9, ai_ml: 0.8 }, area_aliases: ['Makati'], minimum_role_score: 35 }));
  put(path.join(root, 'config/profile.yml'), 'candidate:\n  full_name: Fixture\nlocation:\n  country: Philippines\ninternship_preferences:\n  required_school_hours: 486\n  latest_start_month: 2027-01\n');
  put(path.join(root, 'portals.yml'), 'tracked_companies: []\njob_boards: []\ntitle_filter:\n  positive: [Intern]\n  negative: []\n');
  put(path.join(sourceRun, 'summary.json'), JSON.stringify({ started_at: cached.observed_at, finished_at: cached.observed_at,
    raw_records: 1, unique_listings: 1, queries_with_errors: 0, query_runs: [] }));
  put(path.join(sourceRun, 'unique-results.json'), JSON.stringify([cached]));
  const tracker = '# Tracker\n\n| # | Company | URL |\n|---|---|---|\n| 1 | Cached Employer | https://ph.indeed.com/viewjob?jk=cached |\n';
  put(path.join(root, 'data/applications.md'), tracker);
  put(path.join(root, 'data/pipeline.md'), '# Pipeline\n\n## Pending\n\n- [ ] https://manual.example/jobs/1 | Manual entry\n\n## Processed\n\n- [x] https://done.example/jobs/2 | Done\n');
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: path.join(root, 'config/profile.yml'),
    CAREER_OPS_PORTALS: path.join(root, 'portals.yml'), CAREER_OPS_PIPELINE: path.join(root, 'data/pipeline.md'),
    CAREER_OPS_SCAN_HISTORY: path.join(root, 'data/scan-history.tsv'), CAREER_OPS_TRACKER: path.join(root, 'data/applications.md') };
  const execute = args => spawnSync(process.execPath, [entry, ...args], { cwd: code, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  // The fixture native scan has no sources; missing Python fails before any job-board request.
  const failed = execute(['--refresh']);
  assert.equal(failed.status, 2, failed.stdout + failed.stderr);
  assert.equal(json(path.join(data, 'listings.json')).listings.length, 1);
  assert.equal(json(path.join(data, 'source-status.json')).last_refresh_failed, true);
  assert.match(fs.readFileSync(path.join(data, 'shortlist.md'), 'utf8'), /Source warning/);
  assert.equal(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), tracker);
  const pipeline = fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8');
  assert.match(pipeline, /Manual entry/); assert.match(pipeline, /\[x\].*Done/);
  assert.ok(!pipeline.includes('- [ ] https://ph.indeed.com/viewjob?jk=cached'));
  const ids = json(path.join(data, 'listings.json')).listings.map(job => [job.id, job.priority_score, job.disposition]);
  const again = execute([]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(json(path.join(data, 'listings.json')).listings.map(job => [job.id, job.priority_score, job.disposition]), ids);
  assert.equal(fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8'), pipeline);
  assert.equal(json(path.join(data, 'source-status.json')).last_refresh_failed, true);
  assert.equal(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), tracker);
});
