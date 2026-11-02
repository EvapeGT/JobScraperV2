import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import '../helpers/web-ts-alias-loader.mjs';

const skip = !process.features?.typescript;
const route = skip ? null : await import('@/app/api/pipeline/route');
const core = skip ? null : await import('@/lib/career-ops');
test('real Pipeline API returns source dates and separate discovery dates while leaving tracker and descriptions intact', { skip }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-metadata-api-'));
  const previous = process.env.CAREER_OPS_ROOT;
  try {
    process.env.CAREER_OPS_ROOT = root;
    fs.mkdirSync(path.join(root, 'data/discovery'), { recursive: true });
    const url = 'https://ph.jobstreet.com/job/123';
    const tracker = '| # | Date | Company | Role | Score | Status | Notes | URL |\n|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-01 | Other | Intern | N/A | Applied | My note | https://jobs.example.com/applied |\n';
    const index = JSON.stringify({ listings: [{ id: 'one', canonical_url: url, description: 'Saved description stays unchanged.', first_seen_at: '2026-10-31T16:10:00Z',
      sources: [{ source: 'jobstreet:api', url, posted_at: '2026-10-15T14:15:29Z' }] }] });
    fs.writeFileSync(path.join(root, 'data/applications.md'), tracker);
    fs.writeFileSync(path.join(root, 'data/discovery/listings.json'), index);
    fs.writeFileSync(path.join(root, 'data/pipeline.md'), `## Pending\n- [ ] ${url} | Sun Life | Intern - Software Developer\n- [ ] https://jobs.example.com/undated | Example | Intern\n`);
    fs.writeFileSync(path.join(root, 'data/scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\nhttps://jobs.example.com/undated\t2026-10-29\tworkday-api\tIntern\tExample\tadded\n');
    const response = await route.GET();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.inbox[0].postedAt, '2026-10-15');
    assert.equal(data.inbox[0].firstDiscoveredAt, '2026-11-01');
    assert.equal(data.inbox[0].listingSources[0].label, 'JobStreet');
    assert.equal(data.inbox[1].postedAt, undefined);
    assert.equal(data.inbox[1].firstDiscoveredAt, '2026-10-29');
    assert.equal(core.readScanDates().size, 0, 'evaluation fallback cannot mislabel discovery as posting');
    assert.equal(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), tracker);
    assert.equal(fs.readFileSync(path.join(root, 'data/discovery/listings.json'), 'utf8'), index);
  } finally {
    if (previous == null) delete process.env.CAREER_OPS_ROOT; else process.env.CAREER_OPS_ROOT = previous;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
