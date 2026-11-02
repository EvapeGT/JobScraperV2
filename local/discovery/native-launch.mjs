import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { OFFICIAL_WEB_APP, rootIdentity } from '../../web/src/lib/core/discovery.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const codeRoot = path.resolve(here, '../..');
const dataRoot = getCareerOpsRoot();
const web = path.join(codeRoot, 'web');
const instance = rootIdentity(dataRoot);
const port = Number(process.env.CAREER_OPS_WEB_PORT || 4380);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid original dashboard port.');
const url = `http://127.0.0.1:${port}`;
const dashboardUrl = `${url}/internships`;
if (!fs.existsSync(path.join(web, 'node_modules/next/package.json'))) {
  throw new Error('Install the original dashboard first: run npm ci --no-audit --no-fund inside career-ops/web.');
}
const collector = spawnSync(process.execPath, [path.join(here, 'discovery-launch.mjs'), '--no-open'], { cwd: codeRoot, windowsHide: true, stdio: 'inherit' });
if (collector.status !== 0) throw new Error('The discovery service could not start.');
async function health() {
  try { return await (await fetch(`${url}/api/local-health`, { signal: AbortSignal.timeout(1500) })).json(); }
  catch { return null; }
}
let status = await health();
if (status && (status.app !== OFFICIAL_WEB_APP || status.instance !== instance)) throw new Error(`Port ${port} belongs to another app or workspace.`);
if (!status) {
  const folder = path.join(dataRoot, 'output/web-runs');
  fs.mkdirSync(folder, { recursive: true });
  const logPath = path.join(folder, 'official-web.log');
  const log = fs.openSync(logPath, 'a');
  const mode = fs.existsSync(path.join(web, '.next/BUILD_ID')) ? 'start' : 'dev';
  console.log(`Starting the original Career-ops dashboard (${mode})…`);
  const child = spawn(process.execPath, [path.join(web, 'server.mjs'), mode, '--port', String(port)], {
    cwd: web, detached: true, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, NEXT_TELEMETRY_DISABLED: '1',
      CAREER_OPS_WEB_ALLOWED_HOSTS: '', CAREER_OPS_ALLOWED_ORIGINS: '',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(codeRoot, 'output/playwright-browsers') },
  });
  child.on('error', error => console.error(error.message)); child.unref(); fs.closeSync(log);
  fs.writeFileSync(path.join(folder, 'official-web.pid'), `${child.pid}\n`);
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500)); status = await health();
    if (status?.app === OFFICIAL_WEB_APP && status.instance === instance) break;
  }
  if (status?.app !== OFFICIAL_WEB_APP || status.instance !== instance) throw new Error(`The original dashboard did not become ready. See ${logPath}`);
}
const bridge = await fetch(`${url}/api/discovery?action=status`, { signal: AbortSignal.timeout(10_000) });
if (!bridge.ok) throw new Error(`The dashboard started, but its discovery connection failed (HTTP ${bridge.status}). Check output/web-runs/official-web.log.`);
console.log(`Internship Desk is ready: ${dashboardUrl}`);
if (!process.argv.includes('--no-open')) {
  const browser = spawn('explorer.exe', [dashboardUrl], { windowsHide: true, detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${dashboardUrl} in your browser.`)); browser.unref();
}
