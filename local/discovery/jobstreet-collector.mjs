import path from 'node:path';
import fs from 'node:fs';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { collectJobStreet } from './jobstreet.mjs';

const root = getCareerOpsRoot();
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/discovery.json'), 'utf8'));
if (!policy.discovery_only || policy.auto_apply !== false || policy.auto_outreach !== false) throw new Error('Discovery-only policy required');
const result = await collectJobStreet({ directory: path.join(root, 'data/discovery/jobstreet'), settings: policy.jobstreet });
console.log(JSON.stringify(result.diagnostics));
if (result.diagnostics.errors.length) process.exitCode = 2;
