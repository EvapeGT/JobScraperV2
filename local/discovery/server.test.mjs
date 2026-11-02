import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createDeskServer, APP_ID } from './server.mjs';

async function fixture(t, refresh) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internship-desk-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data/discovery'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/profile.yml'), 'candidate:\n  email: private@example.com\ninternship_preferences:\n  required_school_hours: 486\n');
  fs.writeFileSync(path.join(root, 'config/discovery.json'), JSON.stringify({ discovery_only: true, auto_apply: false, auto_outreach: false }));
  const server = createDeskServer({ dataRoot: root, refresh });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const data = await (await fetch(`${url}/api/data`)).json();
  return { root, url, server, data, headers: { Origin: url, 'X-Desk-Token': data.token } };
}
async function terminalStatus(url) {
  for (let i = 0; i < 30; i++) {
    const state = await (await fetch(`${url}/api/status`)).json();
    if (!state.running) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('refresh did not finish');
}
test('local data API handles first run and exposes no candidate contact details', async t => {
  const f = await fixture(t, async () => 0);
  assert.equal(f.data.index, null); assert.equal(f.data.preferences.hours, 486);
  assert.ok(!JSON.stringify(f.data).includes('private@example.com'));
  assert.equal((await (await fetch(`${f.url}/api/health`)).json()).app, APP_ID);
  const page = await fetch(f.url); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${f.url}/cv.md`)).status, 404);
  assert.equal((await fetch(`${f.url}/api/export`)).status, 404);
});
test('rejects foreign origins, foreign Host, missing tokens and arbitrary commands', async t => {
  let called = 0; const f = await fixture(t, async () => { called++; return 0; });
  assert.equal((await fetch(`${f.url}/api/data`, { headers: { Origin: 'https://elsewhere.test' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(`${f.url}/api/data`, { headers: { Host: 'elsewhere.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: { Origin: f.url } })).status, 403);
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: { 'X-Desk-Token': f.data.token } })).status, 403);
  assert.equal((await fetch(`${f.url}/api/apply`, { method: 'POST', headers: f.headers })).status, 405);
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers, body: 'x'.repeat(2000) })).status, 413);
  assert.equal(called, 0);
});
test('refresh is single-flight and publishes actual source progress and completion', async t => {
  let finish, called = 0;
  const f = await fixture(t, ({ onProgress }) => { called++; onProgress({ source: 'native', state: 'complete' }); return new Promise(resolve => { finish = resolve; }); });
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers })).status, 202);
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers })).status, 409);
  assert.equal(called, 1); assert.equal((await (await fetch(`${f.url}/api/status`)).json()).sources.native, 'complete');
  finish(0); const status = await terminalStatus(f.url);
  assert.equal(status.phase, 'complete'); assert.ok(status.finished_at);
});
test('partial and crashed refresh preserve saved data; unsafe policy refuses to run', async t => {
  let crash = false; const f = await fixture(t, async () => { if (crash) throw new Error('internal secret'); return 2; });
  const file = path.join(f.root, 'data/discovery/listings.json'), contents = JSON.stringify({ listings: [{ id: 'saved' }] });
  fs.writeFileSync(file, contents);
  await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers }); assert.equal((await terminalStatus(f.url)).phase, 'partial');
  crash = true; await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers }); const status = await terminalStatus(f.url);
  assert.equal(status.phase, 'failed'); assert.ok(!JSON.stringify(status).includes('internal secret')); assert.equal(fs.readFileSync(file, 'utf8'), contents);
  fs.writeFileSync(path.join(f.root, 'config/discovery.json'), '{"discovery_only":false,"auto_apply":true}');
  assert.equal((await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers })).status, 403);
});
test('malformed saved data has a useful error; export only reads the canonical CSV', async t => {
  const f = await fixture(t, async () => 0);
  fs.writeFileSync(path.join(f.root, 'data/discovery/listings.json'), '{bad');
  const response = await fetch(`${f.url}/api/data`); assert.equal(response.status, 500); assert.match((await response.json()).error, /Saved discovery data/);
  fs.writeFileSync(path.join(f.root, 'data/discovery/listings.csv'), 'company,title\nExample,Intern\n');
  const csv = await fetch(`${f.url}/api/export`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /internship-listings.csv/); assert.match(await csv.text(), /Example,Intern/);
});
test('a collector exiting zero still shows partial health when its queries report errors', async t => {
  const f = await fixture(t, async () => 0);
  fs.writeFileSync(path.join(f.root, 'data/discovery/source-status.json'), JSON.stringify({
    last_refresh_failed: false,
    last_refresh: [{ name: 'native', exit_code: 0, receipt: { errors: [] } }, { name: 'jobspy', exit_code: 0 }],
    jobspy: { runs: [{ finished_at: new Date().toISOString(), queries_with_errors: 3, query_runs: [] }] },
  }));
  const data = await (await fetch(`${f.url}/api/data`)).json(); assert.equal(data.sources.failed, true);
  await fetch(`${f.url}/api/refresh`, { method: 'POST', headers: f.headers });
  assert.equal((await terminalStatus(f.url)).phase, 'partial');
});
