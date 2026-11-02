import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSources } from './audit.mjs';
test('live-source audit separates raw observations, filtered canonical roles, tracked jobs and genuinely new roles', () => {
  const a = { source: 'jobspy:indeed', source_id: 'a', posted_at: '2026-10-29', description: 'x'.repeat(120) };
  const b = { source: 'jobspy:linkedin', source_id: 'b', description: '' };
  const current = [a, b];
  const jobs = [{ id: 'old', disposition: 'shortlist', application_status: 'Applied', sources: [{ observation_key: 'jobspy:indeed:a' }, { observation_key: 'jobspy:linkedin:b' }] }];
  const result = auditSources(current, [a], jobs, jobs, [{ site: 'indeed', query: 'software intern', count: 100, result_limit_reached: true }]);
  assert.equal(result[1].new_source_records, 0); assert.equal(result[1].retrieved_unique, 1);
  assert.equal(result[1].raw_query_hits, 100); assert.equal(result[1].surviving_roles, 1);
  assert.equal(result[2].new_source_records, 1); assert.equal(result[2].new_ranked_roles, 0);
  assert.equal(result[2].already_tracked, 1); assert.equal(result[2].missing_dates, 1);
  assert.deepEqual(result[1].capped_queries, ['software intern']);
});
