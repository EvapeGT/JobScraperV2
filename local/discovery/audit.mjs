import { observationKey } from './engine.mjs';

// Current refresh only. Retained history and cross-board duplicates are not new
// openings. Counts after filtering include already tracked roles explicitly.
export function auditSources(current, previous, jobs, previousJobs, queries = []) {
  const priorKeys = new Set(previous.map(observationKey));
  const priorRanked = new Set(previousJobs.filter(j => j.disposition !== 'excluded').map(j => j.id));
  return ['jobstreet', 'indeed', 'linkedin'].map(source => {
    const rows = current.filter(row => row.source === (source === 'jobstreet' ? 'jobstreet:api' : `jobspy:${source}`));
    const keys = new Set(rows.map(observationKey));
    const related = jobs.filter(job => job.sources.some(s => keys.has(s.observation_key)));
    const ranked = related.filter(job => job.disposition !== 'excluded');
    const sourceQueries = queries.filter(q => q.site === source);
    return { source, retrieved_unique: keys.size,
      raw_query_hits: sourceQueries.reduce((n, q) => n + q.count, 0),
      surviving_roles: ranked.length, already_tracked: ranked.filter(j => j.application_status).length,
      new_source_records: [...keys].filter(key => !priorKeys.has(key)).length,
      new_ranked_roles: ranked.filter(j => !priorRanked.has(j.id) && !(j.merged_previous_ids || []).some(id => priorRanked.has(id))).length,
      new_untracked_ranked_roles: ranked.filter(j => !j.application_status && !priorRanked.has(j.id) && !(j.merged_previous_ids || []).some(id => priorRanked.has(id))).length,
      missing_dates: rows.filter(row => !row.posted_at).length,
      missing_descriptions: rows.filter(row => String(row.description || '').trim().length < 100).length,
      capped_queries: sourceQueries.filter(q => q.result_limit_reached || q.complete === false).map(q => q.query),
      queries: sourceQueries.map(q => ({ query: q.query, count: q.count, pages: q.pages,
        errors: q.errors, result_limit_reached: !!q.result_limit_reached, complete: q.complete,
        date_order_inversions: q.date_order_inversions, missing_dates: q.missing_dates })) };
  });
}
