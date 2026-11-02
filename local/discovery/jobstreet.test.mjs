import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectJobStreet } from './jobstreet.mjs';

const reply = value => ({ ok: true, status: 200, json: async () => value });
const listing = id => ({ id: String(id), title: 'Java Backend Intern', advertiser: { description: 'Example' },
  locations: [{ label: 'Makati, Metro Manila' }], listingDate: '2026-10-30T00:00:00Z' });
const page = (data, totalCount) => reply({ data, totalCount, sortModes: [{ value: 'ListedDate', isActive: true }] });
const description = '<p>School-required internship: develop Java Spring Boot APIs with engineers, maintain SQL databases and write tests. School endorsement and MOA required.</p>';
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobstreet-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}

test('search walks beyond 100 rows, detects the natural end and reuses descriptions on the next refresh', async t => {
  const root = directory(t); let requests = 0, descriptions = 0;
  const fetchFn = async (url, options) => {
    requests++;
    if (options.method === 'POST') { descriptions++; return reply({ data: { jobDetails: { job: { content: description } } } }); }
    const number = Number(new URL(url).searchParams.get('page'));
    return page(number === 1 ? Array.from({ length: 100 }, (_, i) => listing(i + 1)) : [listing(101)], 101);
  };
  const settings = { queries: ['Java intern'], detail_budget: 200 };
  const first = await collectJobStreet({ directory: root, settings, fetchFn, wait: async () => {} });
  assert.equal(first.diagnostics.records, 101); assert.equal(first.diagnostics.queries[0].complete, true);
  assert.equal(first.diagnostics.errors.length, 0); assert.equal(descriptions, 101);
  const again = await collectJobStreet({ directory: root, settings, fetchFn, wait: async () => {} });
  assert.equal(again.rows.length, 101); assert.equal(descriptions, 101); assert.equal(requests, 105);
});

test('GraphQL HTTP-200 rate refusal stops detail traffic and retains existing cached descriptions', async t => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, 'cache.json'), JSON.stringify({ rows: [{ source_id: '1', description: description,
    description_status: 'full', first_seen_at: '2026-10-01' }] }));
  let posts = 0;
  const fetchFn = async (url, options) => options.method === 'POST'
    ? (posts++, reply({ errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMITED' } }], data: { jobDetails: null } }))
    : page([listing(1), listing(2), listing(3)], 3);
  const result = await collectJobStreet({ directory: root, settings: { queries: ['Java intern'] }, fetchFn, wait: async () => {} });
  assert.equal(posts, 1); assert.match(result.diagnostics.errors[0].error, /RATE_LIMITED/);
  assert.equal(result.rows.find(row => row.source_id === '1').description, description);
  assert.equal(result.rows.find(row => row.source_id === '3').description_status, 'deferred');
});

test('schema errors and capped pages are partial results, never successful empty searches', async t => {
  const root = directory(t);
  const malformed = await collectJobStreet({ directory: root, settings: { queries: ['Java intern'] }, fetchFn: async () => reply({}), wait: async () => {} });
  assert.equal(malformed.diagnostics.queries[0].complete, false); assert.equal(malformed.diagnostics.errors.length, 1);
  const capped = await collectJobStreet({ directory: root, settings: { queries: ['Java intern'], max_pages: 1, detail_budget: 1 },
    fetchFn: async () => page(Array.from({ length: 100 }, (_, i) => ({ ...listing(i), title: 'Accountant' })), 200), wait: async () => {} });
  assert.match(capped.diagnostics.errors[0].error, /Page cap/); assert.equal(capped.rows.length, 100);
});

test('an exact full-page total is complete and actual returned ordering is audited', async t => {
  const result = await collectJobStreet({ directory: directory(t), settings: { queries: ['Java intern'], max_pages: 1 },
    fetchFn: async () => page(Array.from({ length: 100 }, (_, i) => ({ ...listing(i + 1), title: 'Accountant',
      listingDate: i === 1 ? '2026-10-31T00:00:00Z' : '2026-10-30T00:00:00Z' })), 100), wait: async () => {} });
  assert.equal(result.diagnostics.queries[0].complete, true);
  assert.equal(result.diagnostics.errors.length, 0);
  assert.equal(result.diagnostics.queries[0].date_order_inversions, 1);
});
