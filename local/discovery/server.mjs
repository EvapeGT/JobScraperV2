import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot, getProfilePath } from '../../path-resolver.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CODE_ROOT = path.resolve(HERE, '../..');
export const APP_ID = 'career-ops-internship-desk@1';
const jsonFile = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const optionalJson = (file, fallback = {}) => { try { return jsonFile(file); } catch { return fallback; } };

function publicSources(raw) {
  const last = raw.last_refresh || raw.refresh || [];
  const runs = raw.jobspy?.runs || [];
  const latest = [...runs].sort((a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at)))[0];
  const native = last.find(x => x.name === 'native');
  const sourceErrors = last.some(x => x.exit_code !== 0 || x.timed_out) ||
    (native?.receipt?.errors?.length || 0) > 0 || (native?.receipt?.unverified_zero?.length || 0) > 0 ||
    (latest?.queries_with_errors || 0) > 0 || (raw.jobstreet?.errors?.length || 0) > 0;
  return {
    generated_at: raw.generated_at || null,
    source_audit: raw.source_audit || null,
    failed: raw.last_refresh_failed === true || sourceErrors,
    jobstreet: raw.jobstreet || null,
    native: last.find(x => x.name === 'native') ? {
      exit_code: last.find(x => x.name === 'native').exit_code,
      timed_out: last.find(x => x.name === 'native').timed_out,
      receipt: last.find(x => x.name === 'native').receipt,
    } : null,
    jobspy: latest ? {
      started_at: latest.started_at, finished_at: latest.finished_at,
      unique_listings: latest.unique_listings, queries_with_errors: latest.queries_with_errors,
      queries_at_result_limit: latest.queries_at_result_limit || 0, result_budgets: latest.result_budgets,
      exit_code: last.find(x => x.name === 'jobspy')?.exit_code,
      timed_out: last.find(x => x.name === 'jobspy')?.timed_out,
      queries: (latest.query_runs || []).map(q => ({ site: q.site, query: q.query, count: q.count, status: q.status, exit_code: q.exit_code,
        missing_dates: q.missing_dates, missing_descriptions: q.missing_descriptions, date_order_inversions: q.date_order_inversions,
        result_limit_reached: q.result_limit_reached || false })),
    } : null,
    note: 'Saved results survive partial or failed searches. A listing missing from a search is not proof it has closed.',
  };
}

// The only process this service can start is the existing discovery-only runner.
function fixedRefresh({ dataRoot, onProgress }) {
  const folder = path.join(dataRoot, 'output/web-runs');
  fs.mkdirSync(folder, { recursive: true });
  const log = fs.createWriteStream(path.join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}.log`));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HERE, 'run.mjs'), '--refresh'], {
      cwd: CODE_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_HEADLESS: '1' },
    });
    let buffer = '', runDir = null, settled = false;
    const finish = (error, code) => {
      if (settled) return; settled = true; clearInterval(progressTimer); log.end();
      error ? reject(error) : resolve(code);
    };
    const progressTimer = setInterval(() => {
      if (!runDir) return;
      try {
        const text = fs.readFileSync(path.join(runDir, 'jobspy.stdout.log'), 'utf8');
        // Only collector-authored progress lines are displayed, never scraped text.
        const completed = text.split(/\r?\n/).filter(line => {
          try { const item = JSON.parse(line); return item.site && item.query && item.status && !item.event; } catch { return false; }
        }).length;
        if (completed) onProgress({ query_count: completed });
      } catch {}
    }, 2000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      log.write(chunk); buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        const start = line.match(/^Refreshing (native|jobspy|jobstreet); raw logs: (.+)$/);
        if (start) { runDir = start[2]; onProgress({ source: start[1], state: 'running' }); }
        const done = line.match(/^(native|jobspy|jobstreet): (exit (-?\d+)|timed out.*)$/);
        if (done) onProgress({ source: done[1], state: done[3] === '0' ? 'complete' : 'failed' });
      }
    });
    child.stderr.on('data', chunk => log.write(chunk));
    child.once('error', error => finish(error));
    child.once('close', code => finish(null, code));
  });
}

export function createDeskServer({ dataRoot = getCareerOpsRoot(), refresh = fixedRefresh } = {}) {
  const secret = randomBytes(32).toString('hex');
  const instance = createHash('sha256').update(path.resolve(dataRoot).toLowerCase()).digest('hex').slice(0, 16);
  const dir = path.join(dataRoot, 'data/discovery');
  let state = { id: null, running: false, phase: 'idle', started_at: null, finished_at: null, sources: {}, message: 'Ready to search.' };
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const headers = {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    const send = (code, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(code, { ...headers, 'Content-Type': type, ...extra });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Use the local 127.0.0.1 address from the launcher.' });
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'This request must come from your local dashboard.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site requests are disabled.' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { app: APP_ID, instance });
      if (req.method === 'GET' && url.pathname === '/api/data') {
        const profile = yaml.load(fs.readFileSync(getProfilePath(dataRoot), 'utf8'));
        const prefs = profile?.internship_preferences || {};
        const index = fs.existsSync(path.join(dir, 'listings.json')) ? jsonFile(path.join(dir, 'listings.json')) : null;
        return send(200, { token: secret, index, sources: publicSources(optionalJson(path.join(dir, 'source-status.json'))),
          preferences: { hours: prefs.required_school_hours ?? 486, area: prefs.acceptable_onsite_area || 'Metro Manila',
            latest_start_month: prefs.latest_start_month || '2027-01', arrangements: prefs.work_arrangements || ['onsite', 'hybrid', 'remote'] } });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, state);
      if (req.method === 'GET' && url.pathname === '/api/export') {
        if (!fs.existsSync(path.join(dir, 'listings.csv'))) return send(404, { error: 'Refresh listings to create an export.' });
        return send(200, fs.readFileSync(path.join(dir, 'listings.csv')), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="internship-listings.csv"' });
      }
      if (req.method === 'POST' && url.pathname === '/api/refresh') {
        if (req.headers.origin !== origin || req.headers['x-desk-token'] !== secret) return send(403, { error: 'Reload this page before refreshing.' });
        if (state.running) return send(409, { error: 'A refresh is already running.', status: state });
        const policy = optionalJson(path.join(dataRoot, 'config/discovery.json'));
        if (policy.discovery_only !== true || policy.auto_apply !== false || policy.auto_outreach !== false) return send(403, { error: 'Restore the discovery-only settings in config/discovery.json before refreshing.' });
        if (Number(req.headers['content-length'] || 0) > 1024 || req.headers['transfer-encoding']) return send(413, { error: 'The refresh button does not accept search commands or uploaded data.' });
        req.resume();
        state = { id: randomBytes(8).toString('hex'), running: true, phase: 'refreshing', started_at: new Date().toISOString(), finished_at: null,
          sources: { native: 'waiting', jobspy: 'waiting', jobstreet: policy.jobstreet?.enabled ? 'waiting' : 'disabled' }, message: 'Searching company sources, JobStreet, Indeed and LinkedIn. You can keep browsing.' };
        send(202, state);
        Promise.resolve().then(() => refresh({ dataRoot, onProgress: update => {
          if (update.source) state.sources[update.source] = update.state;
          if (update.query_count) state.query_count = update.query_count;
          if (Object.values(state.sources).every(value => ['complete', 'disabled'].includes(value))) {
            state.phase = 'ranking'; state.message = 'Merging saved results, removing duplicates and ranking roles.';
          }
        } })).then(code => {
          const healthy = code === 0 && !publicSources(optionalJson(path.join(dir, 'source-status.json'))).failed;
          state = { ...state, running: false, phase: healthy ? 'complete' : 'partial', finished_at: new Date().toISOString(),
            message: healthy ? 'Refresh complete. Your combined results are ready.' : 'Some sources could not finish. Available results and saved listings are still here.' };
        }).catch(() => {
          state = { ...state, running: false, phase: 'failed', finished_at: new Date().toISOString(), message: 'Refresh could not complete. Saved listings are still here. Try again; local logs are in career-ops/output/web-runs.' };
        });
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(405, { error: 'This action is not available.' });
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/sort.mjs': ['sort.mjs', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const asset = assets[url.pathname];
      if (req.method !== 'GET' || !asset) return send(404, { error: 'Page not found.' });
      send(200, fs.readFileSync(path.join(HERE, 'web', asset[0])), asset[1]);
    } catch {
      send(500, { error: 'Saved discovery data could not be read. Check your profile and discovery files, then reload. Local logs can help diagnose the problem.' });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.INTERNSHIP_DESK_PORT || 4381);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
  const server = createDeskServer();
  server.on('error', error => { console.error(`Internship desk could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Internship desk: http://127.0.0.1:${port}`));
}
