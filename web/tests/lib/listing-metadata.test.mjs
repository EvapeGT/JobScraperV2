import test from 'node:test';
import assert from 'node:assert/strict';
import { postingDay, postingAge, relativePostingDate, listingMetadata, enrichInbox, compareInboxDates, sourceFromUrl, sourceLabel, listingUrl } from '../../src/lib/core/listing-metadata.mjs';
import { parseInbox } from '../../src/lib/pipeline-table.mjs';
import { reconcileInbox } from '../../src/lib/inbox-pending.mjs';
import { parseScanHistoryLine } from '../../../lib/scan-history-columns.mjs';

const street = 'https://ph.jobstreet.com/job/123';
const indeed = 'https://ph.indeed.com/viewjob?jk=abc';
const employer = 'https://company.wd3.myworkdayjobs.com/External/job/Manila/Intern_R123';
const job = { id: 'one', canonical_url: employer, first_seen_at: '2026-10-31T18:00:00Z', sources: [
  { source: 'jobstreet:api', url: street, direct_url: employer, posted_at: '2026-10-29T22:30:00Z' },
  { source: 'jobspy:indeed', url: indeed, posted_at: '2026-10-28T00:00:00.000' },
  { source: 'native:workday-api', url: employer, posted_at: null },
] };

test('board timestamps, date-only strings and scanner epoch dates normalize without becoming discovery dates', () => {
  assert.equal(postingDay('2026-10-29T22:30:00Z'), '2026-10-30');
  assert.equal(postingDay('2026-10-29T00:00:00.000'), '2026-10-29');
  assert.equal(postingDay(Date.parse('2026-10-29T20:00:00Z')), '2026-10-30');
  assert.equal(postingDay('2026-02-30'), undefined);
  assert.equal(postingDay('not a date'), undefined);
  assert.equal(postingAge('2026-10-29', Date.parse('2026-10-31T16:01:00Z')), 3);
  assert.equal(relativePostingDate(undefined), 'Posting date unavailable');
  assert.equal(relativePostingDate('2026-10-29', Date.parse('2026-10-31T16:01:00Z')), 'Posted 3 days ago');
});

test('merged listings retain original sources, source-specific dates, employer platform and separate discovery date', () => {
  const meta = listingMetadata(job);
  assert.equal(meta.postedAt, '2026-10-30');
  assert.equal(meta.postedSource, 'JobStreet');
  assert.equal(meta.firstDiscoveredAt, '2026-11-01');
  assert.deepEqual(meta.listingSources.map(s => s.label), ['JobStreet', 'Indeed', 'Workday']);
  assert.equal(meta.listingSources[1].postedAt, '2026-10-28');
  assert.equal(meta.applicationPlatforms[0].label, 'Workday');
  assert.equal(meta.applicationPlatforms[0].url, employer);
  assert.equal(listingMetadata({ ...job, sources: [...job.sources, { url: indeed, direct_url: employer.replace('/External/', '/en-US/External/') }] }).applicationPlatforms.length, 1, 'locale variants do not duplicate the employer application link');
  assert.equal(listingMetadata({ ...job, sources: [...job.sources, { url: employer, posted_at: '2026-10-01' }] }).postedAt, '2026-10-30', 'duplicate source URL cannot override evidence');
  assert.equal(listingMetadata({ ...job, sources: job.sources.map(s => s.url === employer ? { ...s, posted_at: '2026-10-01' } : s) }).postedAt, '2026-10-01', 'known canonical employer date wins over repost date');
});

test('pipeline parser → exact URL join → API metadata never uses first_seen as postedAt', () => {
  const inbox = parseInbox(`- [ ] ${street} | Acme | Java Intern\n- [ ] https://example.com/unknown | Other | Intern`);
  const scan = parseScanHistoryLine('https://example.com/unknown\t2026-10-31\tother\tIntern\tOther\tadded');
  const output = enrichInbox(inbox, [job], [scan]);
  assert.equal(output[0].postedAt, '2026-10-30');
  assert.equal(output[1].postedAt, undefined);
  assert.equal(output[1].firstDiscoveredAt, '2026-10-31');
  assert.equal(inbox[0].postedAt, undefined, 'read-side mapping is immutable');
  const datedScan = { ...scan, posted_at: '2026-09-15' };
  assert.equal(enrichInbox(inbox, [], [datedScan, scan])[1].postedAt, '2026-09-15', 'later empty scanner fields cannot erase an actual date');
});

test('ambiguous URLs never attribute a sibling opening and all canonical tracker states remain untouched', () => {
  const states = ['Applied', 'Rejected', 'Interview', 'Assessment', 'Responded', 'Offer', 'Hired', 'Discarded', 'SKIP', 'Evaluated'];
  const tracker = states.map((status, i) => ({ url: `https://jobs.example.com/${i}`, status, notes: `personal note ${i}` }));
  const before = JSON.stringify(tracker);
  const inbox = tracker.map(t => ({ ...t, done: false }));
  const result = enrichInbox(reconcileInbox(inbox, tracker), [job]);
  assert.ok(result.every(row => row.done));
  assert.equal(JSON.stringify(tracker), before);
  const ambiguous = enrichInbox([{ url: street, done: false }], [job, { ...job, id: 'different' }]);
  assert.equal(ambiguous[0].postedAt, undefined);
  assert.equal(ambiguous[0].done, false);
});

test('newest sort puts dated roles first; missing dates use discovery date only within undated roles', () => {
  const rows = [{ url: 'z', firstDiscoveredAt: '2026-11-01' }, { url: 'b', postedAt: '2026-10-01' },
    { url: 'a', postedAt: '2026-10-30' }, { url: 'x', firstDiscoveredAt: '2026-10-29' }];
  assert.deepEqual(rows.sort(compareInboxDates).map(r => r.url), ['a', 'b', 'z', 'x']);
});

test('source attribution covers boards and ATS providers without trusting substring-spoofed hosts or unsafe links', () => {
  for (const [url, id] of [[street, 'jobstreet'], [indeed, 'indeed'], ['https://www.linkedin.com/jobs/view/2', 'linkedin'], [employer, 'workday'],
    ['https://boards.greenhouse.io/acme/jobs/1', 'greenhouse'], ['https://jobs.lever.co/acme/1', 'lever'], ['https://jobs.ashbyhq.com/acme/1', 'ashby'],
    ['https://careers.acme.icims.com/jobs/1', 'icims'], ['https://jobs.smartrecruiters.com/acme/1', 'smartrecruiters']]) assert.equal(sourceFromUrl(url), id);
  assert.equal(sourceFromUrl('https://greenhouse.io.evil.example/jobs/1'), 'greenhouse.io.evil.example');
  assert.equal(sourceLabel(sourceFromUrl('https://jobs.lever.co/acme/1')), 'Lever');
  assert.equal(listingUrl('javascript:alert(1)'), '');
  assert.equal(listingUrl('https://user:password@example.com'), '');
});
