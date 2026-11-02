import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { APP_ID } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const dataRoot = getCareerOpsRoot();
const instance = createHash('sha256').update(path.resolve(dataRoot).toLowerCase()).digest('hex').slice(0, 16);
const port = Number(process.env.INTERNSHIP_DESK_PORT || 4381);
const url = `http://127.0.0.1:${port}`;
async function health() {
  try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) }); return await response.json(); } catch { return null; }
}
let status = await health();
if (status && (status.app !== APP_ID || status.instance !== instance)) throw new Error(`Port ${port} is used by another service. Set INTERNSHIP_DESK_PORT to a free port.`);
if (!status) {
  const folder = path.join(dataRoot, 'output/web-runs');
  fs.mkdirSync(folder, { recursive: true });
  const log = fs.openSync(path.join(folder, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.join(here, 'server.mjs')], { cwd: here, detached: true, windowsHide: true,
    stdio: ['ignore', log, log], env: { ...process.env, CAREER_OPS_ROOT: dataRoot } });
  child.on('error', error => console.error(error.message)); child.unref(); fs.closeSync(log);
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250)); status = await health();
    if (status?.app === APP_ID && status.instance === instance) break;
  }
  if (status?.app !== APP_ID || status.instance !== instance) throw new Error(`Could not start the desk. See ${path.join(folder, 'server.log')}`);
}
console.log(`Internship desk is ready: ${url}`);
if (!process.argv.includes('--no-open')) {
  const browser = spawn('explorer.exe', [url], { windowsHide: true, detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${url} in your browser.`)); browser.unref();
}
