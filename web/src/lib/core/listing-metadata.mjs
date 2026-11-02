// Client-safe discovery metadata. The index is evidence, never tracker state.
import { normalizeUrl } from './url-key.mjs';

const platforms = {
  jobstreet: ['JobStreet', 'jobstreet.com'], indeed: ['Indeed', 'indeed.com'],
  linkedin: ['LinkedIn', 'linkedin.com'], workday: ['Workday', 'myworkdayjobs.com', 'workday.com'],
  greenhouse: ['Greenhouse', 'greenhouse.io'], lever: ['Lever', 'lever.co'],
  ashby: ['Ashby', 'ashbyhq.com'], icims: ['iCIMS', 'icims.com'],
  smartrecruiters: ['SmartRecruiters', 'smartrecruiters.com'],
  bamboohr: ['BambooHR', 'bamboohr.com'], workable: ['Workable', 'workable.com'],
  successfactors: ['SAP SuccessFactors', 'successfactors.com', 'successfactors.eu'],
  recruiterbox: ['Recruiterbox', 'recruiterbox.com'], dayforce: ['Dayforce', 'dayforcehcm.com'],
  oracle: ['Oracle Recruiting', 'oraclecloud.com'], taleo: ['Taleo', 'taleo.net'],
  teamtailor: ['Teamtailor', 'teamtailor.com'], recruitee: ['Recruitee', 'recruitee.com'],
};
const boards = new Set(['jobstreet', 'indeed', 'linkedin']);
export function listingUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function sourceFromUrl(value) {
  if (!listingUrl(value)) return null;
  const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return Object.entries(platforms).find(([, [, ...domains]]) => domains.some(d => host === d || host.endsWith(`.${d}`)))?.[0] || host;
}
export function sourceLabel(source) { return platforms[source]?.[0] || source || 'Source unavailable'; }

// Day-only and pandas' timezone-free ISO dates are board calendar dates. Zoned
// timestamps are converted to Manila; numeric scanner dates are epoch millis.
export function postingDay(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(value)) {
    const day = value.slice(0, 10), time = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : undefined;
  }
  const time = typeof value === 'number' || /^\d{12,13}$/.test(String(value)) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(time) || time <= 0) return undefined;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
}
export function postingAge(day, now = Date.now()) {
  const today = postingDay(now), posted = postingDay(day);
  return today && posted ? Math.max(0, Math.round((Date.parse(today) - Date.parse(posted)) / 86400000)) : null;
}
export function relativePostingDate(day, now = Date.now()) {
  const age = postingAge(day, now);
  return age == null ? 'Posting date unavailable' : age === 0 ? 'Posted today' : age === 1 ? 'Posted yesterday' : `Posted ${age} days ago`;
}
export function listingMetadata(job) {
  const seen = new Set();
  const listingSources = (job.sources || []).flatMap(row => {
    const url = listingUrl(row.url), source = sourceFromUrl(url);
    if (!url || seen.has(normalizeUrl(url))) return [];
    seen.add(normalizeUrl(url));
    return [{ source, label: sourceLabel(source), url, postedAt: postingDay(row.posted_at) }];
  });
  const applicationPlatforms = [...new Set([job.canonical_url, ...(job.sources || []).map(s => s.direct_url)].map(listingUrl).filter(Boolean))]
    .filter(url => !boards.has(sourceFromUrl(url)))
    .map(url => ({ source: sourceFromUrl(url), label: sourceLabel(sourceFromUrl(url)), url }))
    // Locale/tracking variants of the same merged employer opening need only
    // one application link. Original evidence URLs remain in listingSources.
    .filter((item, i, all) => all.findIndex(other => new URL(other.url).hostname === new URL(item.url).hostname) === i);
  // Prefer a date reported by the canonical employer page. Otherwise use the
  // latest source posting/reposting date, retaining every source/date below.
  const dated = listingSources.filter(s => s.postedAt).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  const canonical = dated.find(s => normalizeUrl(s.url) === normalizeUrl(job.canonical_url) && !boards.has(s.source));
  const chosen = canonical || dated[0];
  return { postedAt: chosen?.postedAt, postedSource: chosen?.label,
    firstDiscoveredAt: postingDay(job.first_seen_at), listingSources, applicationPlatforms };
}

/** Exact identity join only; never match company/title or change done/status. */
export function enrichInbox(inbox, listings = [], scanRows = []) {
  const byUrl = new Map();
  for (const job of listings) for (const url of [job.canonical_url, ...(job.sources || []).flatMap(s => [s.url, s.direct_url])]) {
    if (!listingUrl(url)) continue;
    const key = normalizeUrl(url);
    if (byUrl.has(key) && byUrl.get(key)?.id !== job.id) byUrl.set(key, null); // ambiguous identity: don't guess
    else if (!byUrl.has(key)) byUrl.set(key, job);
  }
  const scans = new Map();
  for (const row of scanRows) {
    if (!listingUrl(row.url)) continue;
    const key = normalizeUrl(row.url), old = scans.get(key);
    scans.set(key, { ...row, posted_at: postingDay(row.posted_at) || old?.posted_at,
      first_seen: [old?.first_seen, postingDay(row.first_seen)].filter(Boolean).sort()[0] });
  }
  return inbox.map(row => {
    const key = normalizeUrl(row.url), job = byUrl.get(key), scan = scans.get(key);
    const meta = listingMetadata(job || { canonical_url: row.url,
      first_seen_at: scan?.first_seen, sources: [{ url: row.url, posted_at: row.postedAt || scan?.posted_at }] });
    return { ...row, ...meta, postedAt: meta.postedAt || postingDay(row.postedAt) || scan?.posted_at,
      firstDiscoveredAt: meta.firstDiscoveredAt || scan?.first_seen };
  });
}

// Known posting dates first (newest); undated jobs follow by first discovery,
// newest first, then URL for deterministic ties. Discovery is never a post date.
export function compareInboxDates(a, b) {
  if (!!a.postedAt !== !!b.postedAt) return a.postedAt ? -1 : 1;
  return (b.postedAt || b.firstDiscoveredAt || '').localeCompare(a.postedAt || a.firstDiscoveredAt || '') || a.url.localeCompare(b.url);
}
