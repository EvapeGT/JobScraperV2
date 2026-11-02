// JobStreet PH public search and read-only description protocol, informed by
// Freehire (MIT), revision 2fade69ab0ad2605f0ea648cca69c3e7ae99b104.
// See FREEHIRE-NOTICE.txt. No account, browser, proxy or challenge bypass.
import fs from 'node:fs';
import path from 'node:path';

const HOST = 'https://ph.jobstreet.com';
const QUERY = 'query jobDetails($jobId: ID!) { jobDetails(id: $jobId) { job { content(platform: WEB) } } }';
export const DEFAULT_SEARCHES = ['software intern', 'developer intern', 'Java intern', 'Spring Boot intern', 'cloud intern', 'DevOps intern'];
const internship = /\bintern(?:s|ship)?\b|\bojt\b|on.the.job|student trainee/i;
const technical = /software|develop|backend|back.end|java|spring|cloud|devops|platform|infrastructure|programmer|technology|\bIT\b|\bSRE\b/i;
const text = html => String(html || '').replace(/<\/(?:p|li|div|ul|ol|h[1-6])>|<br\s*\/?>/gi, '\n')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const bounded = (n, fallback, max) => Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
function employerUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return url.hostname.endsWith('.myworkdayjobs.com') && url.pathname.includes('/job/')
      || url.hostname === 'jobs.amdocs.com' && url.searchParams.has('pid')
      || url.hostname === 'careers.ibm.com' && url.searchParams.has('jobId');
  } catch { return false; }
}

export async function collectJobStreet({ directory, settings = {}, fetchFn = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date().toISOString() }) {
  fs.mkdirSync(directory, { recursive: true });
  const cacheFile = path.join(directory, 'cache.json');
  let previous = { rows: [] };
  try { previous = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(previous.rows)) throw new Error('Malformed JobStreet cache');
  const cache = new Map(previous.rows.map(row => [row.source_id, row]));
  const current = new Map(), errors = [], queries = [];
  const maxPages = bounded(settings.max_pages, 10, 30);
  const detailBudget = bounded(settings.detail_budget, 80, 200);
  const searches = settings.queries || DEFAULT_SEARCHES;
  if (!Array.isArray(searches) || !searches.length || searches.some(q => typeof q !== 'string' || !q.trim())) throw new Error('Invalid JobStreet queries');
  let requests = 0, details = 0, detailStopped = false, refused = false;
  const started = now();
  async function request(url, body) {
    if (requests++) await wait(1000);
    const response = await fetchFn(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json', 'User-Agent': 'CareerOps-InternshipDiscovery/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      if ([401, 403, 429].includes(response.status)) refused = true;
      throw new Error(`JobStreet HTTP ${response.status}; requests stopped on access/rate refusal`);
    }
    const value = await response.json();
    if (value.errors?.length) {
      if (value.errors.some(e => e.extensions?.code === 'RATE_LIMITED')) refused = true;
      throw new Error(`JobStreet GraphQL: ${value.errors.map(e => e.extensions?.code || e.message).join(', ')}`);
    }
    return value;
  }
  for (const query of searches) {
    if (refused) break;
    const seen = new Set(); let complete = false, total = null, pages = 0, lastPosted = Infinity, inversions = 0, missingDates = 0;
    try {
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({ siteKey: 'PH-Main', where: 'Metro Manila', keywords: query,
          pageSize: '100', page: String(page), sortmode: 'ListedDate' });
        const response = await request(`${HOST}/api/jobsearch/v5/search?${params}`);
        if (!Array.isArray(response.data) || !Number.isSafeInteger(response.totalCount) ||
          !response.sortModes?.some(mode => mode.value === 'ListedDate' && mode.isActive)) throw new Error('Unexpected search schema or newest-first sorting not acknowledged');
        total = response.totalCount; pages++;
        let added = 0;
        for (const item of response.data) {
          if (!/^\d+$/.test(String(item.id)) || seen.has(String(item.id))) continue;
          const id = String(item.id); seen.add(id); added++;
          const posted = Date.parse(item.listingDate);
          if (!Number.isFinite(posted)) missingDates++;
          else { if (posted > lastPosted) inversions++; lastPosted = posted; }
          const company = item.advertiser?.description || item.companyName;
          if (!item.title || !company) continue;
          const old = current.get(id) || cache.get(id);
          const row = { ...old, source: 'jobstreet:api', source_id: id, url: `${HOST}/job/${id}`,
            company, title: item.title, location: item.locations?.[0]?.label || '',
            description: old?.description || '', summary: text(item.teaser),
            description_status: old?.description_status || 'summary-only',
            observed_at: now(), first_seen_at: old?.first_seen_at || now(), posted_at: item.listingDate || old?.posted_at || null,
            job_type: item.workTypes?.join(', ') || '',
            is_remote: item.workArrangements?.data?.some(x => x.label?.text === 'Remote') || false,
            status: 'observed-in-jobstreet-search', discovery_queries: [...new Set([...(old?.discovery_queries || []), query])],
            evidence_file: cacheFile };
          current.set(id, { ...current.get(id), ...row });
        }
        if (!added) {
          complete = seen.size === total;
          if (!complete) throw new Error(`Incomplete search: ${seen.size} distinct of ${total} reported records`);
          break;
        }
        if (seen.size === total) { complete = true; break; }
      }
      if (!complete) throw new Error(`Page cap reached: ${seen.size} of ${total} records; raise max_pages`);
    } catch (error) { errors.push({ phase: 'search', query, error: error.message }); }
    queries.push({ query, pages, count: seen.size, total, complete, date_order_inversions: inversions, missing_dates: missingDates });
  }
  // Keep broad raw results, but spend detail requests only on potential technical
  // internships. Reuse full descriptions across refreshes, newest postings first.
  const candidates = [...current.values()].filter(row => internship.test(row.title) && technical.test(row.title))
    .sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
  for (const row of candidates) {
    if (row.description_status === 'full' && row.description) continue;
    if (refused || detailStopped || details >= detailBudget) {
      row.description_status = 'deferred';
      continue;
    }
    try {
      details++;
      const response = await request(`${HOST}/graphql`, { operationName: 'jobDetails', query: QUERY, variables: { jobId: row.source_id } });
      const html = response.data?.jobDetails?.job?.content;
      if (typeof html !== 'string' || text(html).length < 100) throw new Error('Full description unavailable');
      row.description = text(html); row.description_status = 'full'; row.description_captured_at = now();
      // Employer URLs, when published in the description, provide stronger
      // cross-board identity than an employer/title guess.
      const links = [...html.matchAll(/href=["'](https:\/\/[^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g, '&'));
      row.direct_url = links.find(employerUrl) || row.direct_url || '';
    } catch (error) {
      row.description_status = 'unavailable';
      errors.push({ phase: 'description', id: row.source_id, error: error.message });
      if (refused) detailStopped = true;
    }
  }
  const deferred = candidates.filter(row => row.description_status === 'deferred').length;
  if (deferred) errors.push({ phase: 'description', error: `${deferred} descriptions deferred by the request budget or source refusal` });
  for (const row of current.values()) cache.set(row.source_id, row);
  const result = { started_at: started, finished_at: now(), rows: [...cache.values()],
    diagnostics: { source: 'jobstreet', queries, errors, requests, details_requested: details,
      descriptions_deferred: deferred, records: current.size, cached_records: cache.size, sort: 'newest',
      reference: 'strelov1/freehire@2fade69ab0ad2605f0ea648cca69c3e7ae99b104',
      full_descriptions: candidates.filter(row => row.description_status === 'full').length } };
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n'); fs.renameSync(temporary, cacheFile);
  return result;
}
