import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot, getProfilePath, resolveTrackerPath } from '../../path-resolver.mjs';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { atomicWriteFile, formatPipelineOffer } from '../../scan.mjs';
import { buildIndex, mergeObservations, rewritePending, markTrackedListings } from './engine.mjs';
import { readJson, readText, loadNative, loadJobSpy, renderShortlist, renderCsv, ownedUrlSet, trackedUrls, trackedApplications } from './io.mjs';
import { auditSources } from './audit.mjs';

const CODE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const output = path.join(DATA_ROOT, 'data/discovery');
const pipeline = path.join(DATA_ROOT, 'data/pipeline.md');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node local/discovery/run.mjs [--refresh | --dry-run]\nRefresh runs native discovery and JobSpy, then imports, deduplicates and ranks locally. No applications or outreach.');
  process.exit(0);
}
if (args.some(arg => !['--refresh', '--dry-run'].includes(arg)) || args.includes('--refresh') && args.includes('--dry-run')) {
  console.error('Use --refresh or --dry-run; they cannot be combined.'); process.exit(1);
}
const policy = readJson(path.join(DATA_ROOT, 'config/discovery.json'));
if (!policy || policy.discovery_only !== true || policy.auto_apply !== false || policy.auto_outreach !== false) {
  throw new Error('Discovery-only policy is missing or changed; refusing to run');
}
for (const family of ['java_backend', 'cloud_devops', 'ai_ml']) {
  const weight = policy.role_weights?.[family];
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`Invalid ranking weight: ${family}`);
}
if (!Array.isArray(policy.area_aliases) || !policy.area_aliases.length || policy.area_aliases.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Invalid area aliases');
const profile = yaml.load(readText(getProfilePath(DATA_ROOT)));
const project = path.resolve(CODE_ROOT, policy.jobspy.project);
const python = path.resolve(CODE_ROOT, policy.jobspy.python);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(DATA_ROOT, 'output/discovery-runs', `${stamp}-${randomUUID().slice(0, 6)}`);
const started = new Date().toISOString();
const sourceFailed = item => item.exit_code !== 0 || item.timed_out ||
  (item.receipt?.errors?.length || 0) > 0 || (item.receipt?.unverified_zero?.length || 0) > 0;

async function runProcess(name, command, argv, cwd, timeoutMs) {
  fs.mkdirSync(runDir, { recursive: true });
  const stdout = path.join(runDir, `${name}.stdout.log`), stderr = path.join(runDir, `${name}.stderr.log`);
  const outFd = fs.openSync(stdout, 'w'), errFd = fs.openSync(stderr, 'w');
  console.log(`Refreshing ${name}; raw logs: ${runDir}`);
  let timedOut = false;
  const child = spawn(command, argv, { cwd, windowsHide: true, stdio: ['ignore', outFd, errFd], env: { ...process.env, CAREER_OPS_HEADLESS: '1' } });
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }, timeoutMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ exit_code: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ exit_code: code, signal }));
  });
  clearTimeout(timer); fs.closeSync(outFd); fs.closeSync(errFd);
  let receipt = null;
  if (name === 'native') { try { receipt = JSON.parse(readText(stdout).trim()); } catch {} }
  console.log(`${name}: ${timedOut ? 'timed out; retaining saved data' : `exit ${result.exit_code}`}`);
  return { name, command, argv, ...result, timed_out: timedOut, stdout, stderr, receipt };
}

let refresh = [];
if (args.includes('--refresh')) {
  // Independent HTTP sources; no shared browser session, credentials or application actions.
  refresh = await Promise.all([
    runProcess('native', process.execPath, [path.join(CODE_ROOT, 'scan.mjs'), '--json', '--quiet'], CODE_ROOT, policy.native_timeout_ms),
    runProcess('jobspy', python, ['-X', 'utf8', '-u', path.join(CODE_ROOT, 'local/discovery/jobspy_collector.py'), '--output-root', project,
      '--results-wanted', String(policy.jobspy.results_wanted || 100), '--linkedin-results-wanted', String(policy.jobspy.linkedin_results_wanted || 50)], project, policy.jobspy.timeout_ms),
    ...(policy.jobstreet?.enabled ? [runProcess('jobstreet', process.execPath,
      [path.join(CODE_ROOT, 'local/discovery/jobstreet-collector.mjs')], CODE_ROOT, policy.jobstreet.timeout_ms || 600000)] : []),
  ]);
}
const native = loadNative(DATA_ROOT), spy = loadJobSpy(project);
const street = readJson(path.join(output, 'jobstreet/cache.json'), { rows: [], diagnostics: null });
let final;
await withPipelineLock(pipeline, async () => {
  const oldObservations = readJson(path.join(output, 'observations.json'), []);
  const oldIndex = readJson(path.join(output, 'listings.json'), { listings: [] });
  const oldStatus = readJson(path.join(output, 'source-status.json'), {});
  const lastRefresh = refresh.length ? refresh : oldStatus.last_refresh || oldStatus.refresh || [];
  const lastRefreshFailed = lastRefresh.some(sourceFailed);
  const observations = mergeObservations(oldObservations, [...native.rows, ...spy.rows, ...street.rows]);
  if (!observations.length) throw new Error('No saved discovery inputs. Run with --refresh; no existing data was erased.');
  const listings = markTrackedListings(buildIndex(observations, policy, profile.internship_preferences, oldIndex.listings),
    trackedApplications(resolveTrackerPath(DATA_ROOT)), policy);
  const included = listings.filter(job => job.disposition !== 'excluded');
  const latestSpy = [...spy.diagnostics.runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  const freshSpy = refresh.length && Date.parse(latestSpy?.started_at) >= Date.parse(started) - 2000;
  const spyRows = freshSpy ? spy.rows.filter(row => row.evidence_file === path.join(path.dirname(latestSpy.file), 'unique-results.json')) : [];
  const freshStreet = refresh.length && Date.parse(street.started_at) >= Date.parse(started) - 2000;
  const currentRows = [...spyRows, ...(freshStreet ? street.rows.filter(row => Date.parse(row.observed_at) >= Date.parse(street.started_at)) : [])];
  const sourceAudit = refresh.length ? { started_at: started, sources: auditSources(currentRows, oldObservations, listings, oldIndex.listings,
    [...(freshSpy ? latestSpy.query_runs : []), ...(freshStreet ? street.diagnostics.queries.map(q => ({ ...q, site: 'jobstreet' })) : [])]) } : oldStatus.source_audit;
  const metrics = { source_observations: observations.length, canonical_roles: listings.length,
    duplicate_source_listings: observations.length - listings.length, ranked_leads: included.length,
    review_leads: included.filter(job => job.disposition === 'review').length,
    excluded: listings.length - included.length, spring_boot_ranked: included.filter(job => job.spring_boot_mentioned).length,
    possible_duplicate_pairs: listings.reduce((count, job) => count + job.possible_duplicate_ids.length, 0) / 2,
    tracked_leads: included.filter(job => job.application_status).length,
    new_ranked_leads: included.filter(job => !oldIndex.listings.some(old => old.id === job.id && old.disposition !== 'excluded')).length };
  const generated = new Date();
  const index = { schema: 'local-discovery-index@1', generated_at: generated.toISOString(),
    generated_at_manila: generated.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' }),
    discovery_only: true, ranking_weights: policy.role_weights, last_refresh_failed: lastRefreshFailed, metrics, listings };
  const existing = readText(pipeline);
  const next = rewritePending(existing, listings, ownedUrlSet(observations), formatPipelineOffer, trackedUrls(resolveTrackerPath(DATA_ROOT)))
    .replace('Paste job URLs below as `- [ ] {url}` then run `/career-ops pipeline`.',
      'Ranked discovery leads from native sources and JobSpy. Open data/discovery/shortlist.md for reasons, original links and eligibility checks. No application actions are performed.');
  final = { ...metrics, dry_run: args.includes('--dry-run'), shortlist: path.join(output, 'shortlist.md'), pipeline,
    refresh_failed: refresh.some(sourceFailed), applications_submitted: 0, source_audit: sourceAudit };
  if (args.includes('--dry-run')) return;
  fs.mkdirSync(output, { recursive: true });
  const backup = path.join(output, 'backups', `${stamp}-${randomUUID().slice(0, 6)}`);
  fs.mkdirSync(backup, { recursive: true });
  if (fs.existsSync(pipeline)) fs.copyFileSync(pipeline, path.join(backup, 'pipeline.md'));
  for (const name of ['observations.json', 'listings.json']) if (fs.existsSync(path.join(output, name))) fs.copyFileSync(path.join(output, name), path.join(backup, name));
  atomicWriteFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
  atomicWriteFile(path.join(output, 'listings.json'), JSON.stringify(index, null, 2) + '\n');
  atomicWriteFile(path.join(output, 'shortlist.md'), renderShortlist(index));
  atomicWriteFile(path.join(output, 'listings.csv'), renderCsv(listings));
  atomicWriteFile(path.join(output, 'source-status.json'), JSON.stringify({ generated_at: generated.toISOString(),
    mode: refresh.length ? 'refreshed' : 'cached', refresh, last_refresh: lastRefresh,
    last_refresh_failed: lastRefreshFailed, source_audit: sourceAudit, cached_native: native.diagnostics, jobspy: spy.diagnostics, jobstreet: street.diagnostics,
    note: 'Saved data is retained across failed/partial refreshes. A result disappearing from a bounded search is not evidence it expired.' }, null, 2) + '\n');
  atomicWriteFile(pipeline, next);
});
if (!args.includes('--dry-run')) {
  fs.mkdirSync(runDir, { recursive: true });
  atomicWriteFile(path.join(runDir, 'run.json'), JSON.stringify({ started, finished: new Date().toISOString(), refresh, result: final }, null, 2) + '\n');
}
console.log(JSON.stringify(final));
if (final.refresh_failed) process.exitCode = 2;
