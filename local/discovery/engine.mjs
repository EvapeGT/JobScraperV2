import { createHash } from 'node:crypto';
import { normalizeUrl, isAggregatorUrl } from '../../url-key.mjs';
import { requisitionIdsForDedup } from '../../scan.mjs';
import { postingTime } from './web/sort.mjs';
import { listingMetadata } from '../../web/src/lib/core/listing-metadata.mjs';
export { postingTime } from './web/sort.mjs';

export const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
export const fold = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const words = value => fold(value).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = value => words(value).replace(/\s+/g, '');
const unique = values => [...new Set(values.filter(Boolean))];
const TITLE_INTERN = /\bintern(?:s|ship(?:s)?)?\b|\bojt\b|on.the.job|student trainee/i;
const FRAMEWORK = /\bspring[\s-]*boot\b/i;

export function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '';
    return normalizeUrl(u.href);
  } catch { return ''; }
}

export function companyKey(value, policy = {}) {
  let name = words(value).replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc)\b/g, '').replace(/\s+/g, ' ').trim();
  name = policy.company_aliases?.[name] ?? name;
  return compact(name);
}

export function titleKey(value) {
  return words(value).replace(/\binterns\b/g, 'intern').replace(/\s+/g, ' ').trim();
}

export function observationKey(row) {
  return `${row.source}:${row.source_id || safeUrl(row.url)}`;
}

function normalizeObservation(row) {
  const url = safeUrl(row.url);
  if (!url || !String(row.company ?? '').trim() || !String(row.title ?? '').trim()) return null;
  return {
    ...row, url, direct_url: safeUrl(row.direct_url), source: String(row.source || 'unknown'),
    company: String(row.company).trim(), title: String(row.title).trim(),
    location: String(row.location || ''), description: String(row.description || ''),
    description_captured_at: row.description_captured_at || (row.description ? row.observed_at : undefined),
    source_id: String(row.source_id || url),
  };
}

export function mergeObservations(previous, incoming) {
  // Legacy caches lack capture timestamps. Recover them from actual nonempty
  // raw snapshots, rather than treating a retained description as freshly read.
  const captures = new Map();
  for (const row of incoming) if (String(row.description || '').trim().length >= 80) {
    const key = `${observationKey(row)}:${hash(row.description)}`, captured = row.description_captured_at || row.observed_at;
    if (Date.parse(captured) > (Date.parse(captures.get(key)) || 0)) captures.set(key, captured);
  }
  const rows = new Map();
  const migrated = previous.map(row => row.description_captured_at ? row : { ...row,
    description_captured_at: captures.get(`${observationKey(row)}:${hash(row.description)}`) });
  for (const raw of [...migrated, ...incoming]) {
    const row = normalizeObservation(raw);
    if (!row) continue;
    const key = observationKey(row), old = rows.get(key);
    if (!old) { rows.set(key, row); continue; }
    // Importing an old snapshot never overwrites a newer observation.
    const [older, newer] = (Date.parse(old.observed_at) || 0) <= (Date.parse(row.observed_at) || 0) ? [old, row] : [row, old];
    const merged = { ...older };
    for (const [name, value] of Object.entries(newer)) {
      if (value !== null && value !== undefined && value !== '') merged[name] = value;
    }
    if (String(newer.description || '').trim().length < 80 && older.description?.length >= 80) {
      merged.description = older.description;
      merged.description_captured_at = older.description_captured_at || older.observed_at;
    }
    merged.first_seen_at = [old.first_seen_at || old.observed_at, row.first_seen_at || row.observed_at].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || '';
    merged.discovery_queries = unique([...(old.discovery_queries || []), ...(row.discovery_queries || [])]);
    rows.set(key, merged);
  }
  return [...rows.values()].sort((a, b) => observationKey(a).localeCompare(observationKey(b)));
}

function reqs(row) {
  return unique(requisitionIdsForDedup({ url: row.direct_url || row.url, text: `${row.title || ''}\n${row.description || ''}`,
    requisitionId: row.requisition_id || String(row.title || '').match(/\bR\d{5,}\b/i)?.[0]?.toUpperCase() }));
}
function links(row) { return unique([safeUrl(row.url), safeUrl(row.direct_url)]); }
function intersects(a, b) { return a.some(value => b.includes(value)); }
function aggregator(raw) {
  try { return isAggregatorUrl(raw) || /(^|\.)(kalibrr\.com|jobstreet\.com)$/.test(new URL(raw).hostname); }
  catch { return true; }
}
function employerLinks(row) { return links(row).filter(url => !aggregator(url)); }

export function descriptionSimilarity(left, right) {
  const a = words(left).split(' '), b = words(right).split(' ');
  if (Math.min(a.length, b.length) < 45) return 0;
  const shingles = tokens => new Set(tokens.slice(0, -2).map((_, i) => tokens.slice(i, i + 3).join(' ')));
  const x = shingles(a), y = shingles(b);
  const overlap = [...x].filter(token => y.has(token)).length;
  const jaccard = overlap / (x.size + y.size - overlap);
  const containment = overlap / Math.min(x.size, y.size);
  return Math.min(x.size, y.size) >= 60 && containment >= 0.95 && Math.min(x.size, y.size) / Math.max(x.size, y.size) >= 0.55
    ? Math.max(jaccard, 0.9) : jaccard;
}

function compatibleLocations(a, b, policy) {
  if (!a || !b || words(a) === words(b)) return true;
  const aliases = policy.area_aliases || [];
  const cityAliases = aliases.filter(alias => !['metro manila', 'national capital region', 'manila', 'the globe tower'].includes(words(alias)));
  const city = location => cityAliases.filter(alias => words(location).includes(words(alias))).map(words);
  const x = city(a), y = city(b);
  // A generic Metro Manila location is compatible with a specific city.
  return !x.length || !y.length || intersects(x, y);
}

export function duplicateReason(group, candidate, policy) {
  const sameCompany = group.every(row => companyKey(row.company, policy) === companyKey(candidate.company, policy));
  const candidateReq = reqs(candidate), groupReq = unique(group.flatMap(reqs));
  if (candidateReq.length && groupReq.length && !intersects(candidateReq, groupReq)) return null;
  const sameEmployerLink = group.some(row => intersects(employerLinks(row), employerLinks(candidate)));
  const sameReq = sameCompany && candidateReq.length && intersects(candidateReq, groupReq);
  if (sameReq) return 'employer requisition ID';
  if (sameEmployerLink) return 'canonical employer posting URL';
  if (group.some(row => observationKey(row) === observationKey(candidate))) return 'source posting ID';
  // Different IDs on the same board remain separate without stronger employer evidence.
  if (group.some(row => row.source === candidate.source && row.source_id !== candidate.source_id)) return null;
  if (group.some(row => intersects(links(row), links(candidate)))) return 'canonical posting URL';
  if (!sameCompany) return null;
  const near = group.filter(row => titleKey(row.title) === titleKey(candidate.title)
    && compatibleLocations(row.location, candidate.location, policy));
  const threshold = policy.body_similarity_threshold ?? 0.82;
  return near.some(row => descriptionSimilarity(row.description, candidate.description) >= threshold)
    ? 'same employer/title/location and near-identical description' : null;
}

function canonicalLink(rows) {
  return rows.flatMap(row => links(row).map(url => ({
    url, score: (aggregator(url) ? 0 : 100) + (row.source.startsWith('native:') ? 20 : 0) + (row.direct_url === url ? 5 : 0),
  }))).sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))[0]?.url || '';
}

export function deduplicate(observations, policy, previousJobs = []) {
  const previousIds = new Map(previousJobs.flatMap(job => job.sources.map(source => [source.observation_key, job.id])));
  const groups = [];
  const buckets = new Map();
  for (const row of observations) {
    // Compare only plausible identities. Board pagination can produce thousands
    // of rows; scanning every unrelated employer for every row is quadratic.
    const keys = [`company:${companyKey(row.company, policy)}`, `source:${observationKey(row)}`, ...links(row).map(url => `url:${url}`)];
    const candidates = [...new Set(keys.flatMap(key => [...(buckets.get(key) || [])]))].sort((a, b) => a.order - b.order);
    let group = candidates.find(item => duplicateReason(item.rows, row, policy));
    if (group) { group.evidence.push(duplicateReason(group.rows, row, policy)); group.rows.push(row); }
    else { group = { rows: [row], evidence: [], order: groups.length }; groups.push(group); }
    for (const key of keys) { if (!buckets.has(key)) buckets.set(key, new Set()); buckets.get(key).add(group); }
  }
  const jobs = groups.map(({ rows, evidence }) => {
    const preferred = [...rows].sort((a, b) => (b.description.length >= 100 ? 1 : 0) - (a.description.length >= 100 ? 1 : 0)
      || b.description.length - a.description.length || a.url.localeCompare(b.url))[0];
    const keys = rows.map(observationKey).sort();
    const prior = unique(keys.map(key => previousIds.get(key))).sort();
    const native = rows.find(row => row.source.startsWith('native:'));
    const job = {
      id: prior[0] || `job-${hash(keys[0])}`, merged_previous_ids: prior.slice(1),
      company: native?.company || preferred.company, title: native?.title || preferred.title,
      alternative_titles: unique(rows.map(row => row.title)), location: preferred.location || native?.location || '',
      locations: unique(rows.map(row => row.location)), description: preferred.description,
      canonical_url: canonicalLink(rows), requisition_ids: unique(rows.flatMap(reqs)),
      first_seen_at: rows.map(row => row.first_seen_at || row.observed_at).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || '',
      last_seen_at: rows.map(row => row.observed_at).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || '',
      posted_dates: unique(rows.map(row => row.posted_at)),
      description_captured_at: preferred.description_captured_at || preferred.observed_at,
      sources: rows.map(row => ({ observation_key: observationKey(row), source: row.source, source_id: row.source_id,
        url: row.url, direct_url: row.direct_url, observed_at: row.observed_at, posted_at: row.posted_at || null,
        status: row.status || 'observed', description_available: !!row.description, description_hash: row.description ? hash(row.description) : null })),
      dedup_evidence: unique(evidence), possible_duplicate_ids: [],
      is_remote: rows.some(row => row.is_remote === true),
      expired: rows.some(row => row.source.startsWith('native:') && row.status === 'expired') || rows.every(row => row.status === 'expired'),
    };
    return { ...job, ...listingMetadata(job) };
  });
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const a = jobs[i], b = jobs[j];
    if (companyKey(a.company, policy) !== companyKey(b.company, policy) || titleKey(a.title) !== titleKey(b.title)) continue;
    if (a.requisition_ids.length && b.requisition_ids.length && !intersects(a.requisition_ids, b.requisition_ids)) continue;
    a.possible_duplicate_ids.push(b.id); b.possible_duplicate_ids.push(a.id);
  }
  return jobs;
}

function phrases(text, expressions) { return expressions.filter(expression => new RegExp(expression, 'i').test(text)); }
const excerpt = (text, expression) => {
  const match = expression.exec(text);
  return match ? text.slice(Math.max(0, match.index - 45), match.index + match[0].length + 100).replace(/\s+/g, ' ').trim() : null;
};

export function rankJob(job, policy, preferences = {}) {
  const title = words(job.title), body = job.description, text = `${job.title}\n${body}`;
  const flags = [], reasons = [];
  const internshipTitle = TITLE_INTERN.test(job.title);
  const internshipBody = /\b(this internship|internship position|as (?:an?|the) [^.!?\n]{0,35}intern|internship opportunity)\b/i.test(body)
    || /\b(?:job|employment)\s*types?\s*:[^.!?\n]{0,80}\b(?:internship|ojt)\b|\b(?:ojt|on.the.job training)\s+(?:placement|position|role)\b/i.test(body);
  const internship = internshipTitle ? 'confirmed-title' : internshipBody ? 'description-evidence-review' : 'unconfirmed';
  let exclusion = null;
  if (job.expired) exclusion = 'Explicitly expired in all available observations';
  else if (internship === 'unconfirmed') exclusion = 'No internship/OJT evidence; regular or unconfirmed job';
  if (!internshipTitle && /\b(senior|sr|staff|principal|lead|manager|director)\b/.test(title)) exclusion ||= 'Regular experienced role; company internship text is not internship eligibility';
  if (internship === 'description-evidence-review') flags.push('Internship status needs confirmation; title does not identify an internship');

  const locations = job.locations.filter(Boolean);
  const ncr = locations.some(location => (policy.area_aliases || []).some(alias => (` ${words(location)} `).includes(` ${words(alias)} `)));
  const remotePH = job.is_remote && /philippines/i.test(locations.join(' '));
  let locationStatus = ncr ? 'Metro Manila' : remotePH ? 'Philippines remote; confirm work from Metro Manila' : 'unconfirmed';
  if (!ncr && !remotePH && locations.length && !locations.every(location => /^philippines(?:\s*[,·-]?\s*remote)?$/i.test(location.trim())
    || job.is_remote && /^(?:remote|work from home)$/i.test(location.trim()))) {
    exclusion ||= 'Outside Metro Manila / no confirmed eligible remote arrangement'; locationStatus = 'outside target area';
  } else if (!ncr) flags.push('Confirm the role permits working from Metro Manila');

  const spring = FRAMEWORK.test(text), java = /\bjava\b/i.test(text);
  const backendTitle = /backend|back end/.test(title);
  const softwareTitle = /software|developer|programmer|full stack|fullstack|application/.test(title);
  const technologyProgram = /technology|information technology/.test(title) && /software|\bjava\b|devops|cloud|application development/i.test(body);
  const cloudTitle = /devops|cloud|platform|infrastructure|site reliability|\bsre\b/.test(title);
  const aiTitle = /\bai\b|machine learning|\bml\b|mlops|data engineer/.test(title);
  const api = /\bapis?\b|restful|server.side|microservices/i.test(body);
  const database = /\bsql\b|mysql|postgres|database/i.test(body);
  const development = /develop|coding|programming|code review|debug|software engineering/i.test(body);
  const testing = /\btesting\b|junit|unit tests|automated tests/i.test(body);
  const cloudSignals = phrases(body, ['\\bAWS\\b|Amazon Web Services', '\\bAzure\\b|\\bGCP\\b', '\\bDocker\\b|container', 'deploy|provision|infrastructure', 'CI/CD|pipeline|automat', 'monitor|observability']);
  const genericTechnicalTitle = /\bit\b|technology|technical|engineering|systems?|computer|programmer|mlops/.test(title);
  const developmentDuties = /\b(?:assist|build\w*|develop\w*|implement\w*|maintain\w*|debug\w*|write|make|test\w*)\b[^.!?\n]{0,100}\b(?:software|programs?|applications?|code|apis?|microservices|backend|unit tests?|databases?)\b/i.test(body);
  const backendScope = genericTechnicalTitle && developmentDuties && (java || spring || api && database);
  const deploymentDuties = /\b(?:deploy\w*|provision\w*|automat\w*|maintain\w*|monitor\w*)\b[^.!?\n]{0,100}\b(?:pipelines?|containers?|cloud services?|cloud platforms?|aws|azure|gcp|microservices|cloud workloads?)\b/i.test(body);
  const cloudScope = genericTechnicalTitle && cloudSignals.length >= 3 && deploymentDuties;
  const aiSignals = phrases(body, ['\\bPython\\b', 'machine learning|\\bMLflow\\b|\\bLLM\\b|model', 'inference|embedding|retriev|training|data pipeline', 'PyTorch|TensorFlow|scikit|Databricks']);
  let backend = (backendTitle ? 60 : softwareTitle ? 50 : technologyProgram ? 35 : 0) + (java ? 16 : 0) + (spring ? 22 : 0)
    + (api ? 5 : 0) + (database ? 4 : 0) + (development ? 8 : 0) + (testing ? 4 : 0);
  let cloud = (cloudTitle ? 60 : 0) + Math.min(30, cloudSignals.length * 6);
  let ai = (aiTitle ? 60 : 0) + Math.min(30, aiSignals.length * 8);
  // A technology in a generic description cannot outweigh the actual work.
  if (!softwareTitle && !backendTitle) backend = Math.min(backend, technologyProgram ? 60 : 45);
  if (!cloudTitle) cloud = Math.min(cloud, 40);
  if (!aiTitle) ai = Math.min(ai, 40);
  if (backendScope && !softwareTitle && !backendTitle) backend = Math.max(backend, 40);
  if (cloudScope && !cloudTitle) cloud = Math.max(cloud, 45);
  const descriptionScope = backendScope && !softwareTitle && !backendTitle || cloudScope && !cloudTitle;
  if (descriptionScope) flags.push('Engineering duties appear in the description; confirm actual team assignment and stack');
  if (technologyProgram) flags.push('Broad technology program: confirm team placement and assigned stack');
  if (!java && !spring && (/\bphp\b|laravel|\brust\b|ruby|\.net|c#/.test(title)
      || /strong (?:knowledge|experience).{0,40}\bPHP\b/i.test(body))) {
    backend = Math.max(0, backend - 20);
    flags.push('Advertised primary stack differs from Java/Spring Boot');
  }
  const roleActions = (body.match(/\b(?:assist|build|develop|implement|maintain|test|monitor|deploy|automat|support|knowledge|qualification|responsibilit)\w*/gi) || []).length;
  const thin = body.trim().split(/\s+/).length < 90 || roleActions < 2;
  const documentation = /document|wiki|knowledge base|technical writing/gi;
  if ((body.match(documentation) || []).length >= 5 && !/deploy|provision|implement.*pipeline/i.test(body)) {
    backend = Math.max(0, backend - 40); cloud = Math.max(0, cloud - 45); ai = Math.max(0, ai - 35);
    flags.push('Description focuses on documentation/knowledge management, not hands-on engineering');
  }
  if (/technical (?:writer|documentation)|documentation intern/.test(title)) exclusion ||= 'Documentation-focused role outside target engineering duties';
  if (/\bhr\b|human resource|people and stakeholder|social media|multimedia|corporate communications|accounting|finance operations|graphic|retail|sales intern|production intern|member success|electrical engineer|industrial engineer|mechanical engineer|civil engineer|chemical engineer|architect drafting/.test(title)) {
    backend = cloud = ai = 0; exclusion ||= 'Unrelated internship discipline';
  }
  const scores = { java_backend: Math.min(100, backend), cloud_devops: Math.min(100, cloud), ai_ml: Math.min(100, ai) };
  const weighted = Object.entries(scores).map(([family, score]) => ({ family, score: Math.round(score * (policy.role_weights?.[family] ?? 1)) }));
  weighted.sort((a, b) => b.score - a.score);
  let best = weighted[0];
  if (policy.focus_families?.length && !policy.focus_families.includes(best.family)) {
    // A mixed MLOps/technical internship can have real deployment duties. Mere
    // company-stack keywords must not turn an AI-only role into a target role.
    best = weighted.find(item => policy.focus_families.includes(item.family) && item.score >= (policy.minimum_role_score ?? 35)
      && (item.family === 'java_backend' ? backendScope : item.family === 'cloud_devops' && cloudScope)) || best;
    if (!policy.focus_families.includes(best.family)) exclusion ||= 'Outside the selected Java/backend and cloud/DevOps tracks';
  }
  const focusedBackend = policy.focus_families?.includes('java_backend') && best.family === 'java_backend';
  const otherStack = !java && !spring && (/front.end|wordpress|web design|ui ux|flutter|game developer|\brust\b/.test(title)
    || /(?:knowledge\w*|experience|proficien\w*|using|skills?|develop\w*)[^.!?\n]{0,85}(?:\bPHP\b|Laravel|\bNode(?:\.js|js)\b|\bC#|\.NET)/i.test(body));
  if (focusedBackend && otherStack) exclusion ||= 'Explicit frontend or non-Java stack outside the selected focus';
  if (!exclusion && Math.max(...Object.values(scores)) < (policy.minimum_role_score ?? 35)) exclusion = 'Insufficient evidence of a target engineering role';
  if (softwareTitle || backendTitle) reasons.push('Software/backend work in the role title');
  if (java) reasons.push('Java mentioned; assigned stack still needs confirmation');
  if (spring) reasons.push('Spring Boot explicitly mentioned');
  if (api && database) reasons.push('API and database work');
  if (cloudTitle) reasons.push('Cloud/DevOps/infrastructure role');
  if (cloudSignals.length && cloudTitle) reasons.push('Deployment, infrastructure, automation or monitoring mentioned');
  if (aiTitle) reasons.push('AI/ML/data engineering role');
  if (aiSignals.length && aiTitle) reasons.push('Python, model or data-pipeline keywords mentioned');
  if (!java && !spring && best.family === 'java_backend') flags.push('Java/Spring Boot stack not specified');
  if (thin) flags.push('Limited role-description evidence; clarify responsibilities');

  const requiredHours = preferences.required_school_hours ?? 486;
  const hours = unique([...text.matchAll(/\b(\d{3,4})\s*\+?\s*(?:or more\s+)?(?:internship\s+)?hours?\b/gi)].map(match => Number(match[1])));
  if (!hours.length) flags.push(`Confirm support for ${requiredHours} school hours and MOA`);
  if (hours.some(value => value > requiredHours)) flags.push(`Posting states ${Math.max(...hours)}+ hours; confirm acceptance of a ${requiredHours}-hour school requirement`);
  if (hours.some(value => value < requiredHours) && !/extend.{0,50}(?:longer|hours)|more than.{0,12}hours.{0,80}(?:school|academic)|school.{0,80}extend/i.test(text)) flags.push(`Listed hours below ${requiredHours}; confirm extension before assuming eligibility`);
  const extension = /extend.{0,50}(?:longer|hours)|more than.{0,12}hours.{0,80}(?:school|academic)/i.test(text);
  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december';
  const startMatch = new RegExp(`(?:start(?:ing)?|commenc(?:e|ing)|begin(?:ning)?)[^.!?\\n]{0,45}?(${monthNames})\\s+(202[6-9])`, 'i').exec(text);
  const summer = /summer[^\n.]{0,60}2027|2027[^\n.]{0,60}summer/i.test(job.title);
  if (summer && preferences.latest_start_month && preferences.latest_start_month < '2027-04') exclusion ||= 'Summer 2027 start likely after the January start window';
  let start = null;
  if (startMatch) {
    const month = monthNames.split('|').indexOf(startMatch[1].toLowerCase()) + 1;
    start = `${startMatch[2]}-${String(month).padStart(2, '0')}`;
    if (preferences.latest_start_month && start > preferences.latest_start_month) exclusion ||= `Stated start ${start} is after the requested start window`;
  } else flags.push('Start date needs confirmation (latest preferred start: January 2027)');
  if (/six months|6\s*months/i.test(text)) flags.push('Six-month commitment mentioned; confirm weekly availability and term');
  if (job.possible_duplicate_ids.length) flags.push('Possible cross-post: insufficient identity evidence to merge safely');
  if (/pooling/i.test(job.title)) flags.push('For pooling; immediate vacancy/start not guaranteed');
  return {
    ...job, role_scores: scores, family: best.family, priority_score: best.score,
    spring_boot_mentioned: spring, java_mentioned: java, internship_evidence: internship,
    location_status: locationStatus, stated_hours: hours, extension_explicit: extension,
    hours_evidence: excerpt(text, /\b\d{3,4}\s*\+?\s*(?:or more\s+)?(?:internship\s+)?hours?\b/i),
    stated_start_month: start, reasons: unique(reasons), review_flags: unique(flags),
    disposition: exclusion ? 'excluded' : internship !== 'confirmed-title' || locationStatus !== 'Metro Manila' || thin || technologyProgram || descriptionScope || focusedBackend && !java && !spring ? 'review' : 'shortlist',
    exclusion_reason: exclusion, ranking_method: 'Local explainable keyword/role scoring; not a career-ops A-F evaluation or eligibility guarantee',
  };
}

export function buildIndex(observations, policy, preferences, previousJobs = []) {
  return deduplicate(observations, policy, previousJobs).map(job => rankJob(job, policy, preferences))
    .sort((a, b) => (a.disposition === 'excluded') - (b.disposition === 'excluded')
      || (policy.sort_order === 'newest' ? postingTime(b) - postingTime(a)
        || (!postingTime(a) && !postingTime(b) ? (b.firstDiscoveredAt || '').localeCompare(a.firstDiscoveredAt || '') : 0) : 0) || b.priority_score - a.priority_score
      || a.company.localeCompare(b.company) || a.id.localeCompare(b.id));
}

// Read-only tracker association. A title guess never changes an application's
// status or merges distinct requisitions. Exact posting identities inherit the
// existing tracker status only in this derived index.
export function markTrackedListings(jobs, applications, policy) {
  for (const job of jobs) {
    const urls = new Set([job.canonical_url, ...job.sources.flatMap(s => [s.url, s.direct_url])].map(safeUrl).filter(Boolean));
    const matched = applications.find(app => urls.has(safeUrl(app.url)));
    if (matched) {
      job.application_status = matched.status; job.application_url = safeUrl(matched.url);
      job.application_match = 'posting URL';
      continue;
    }
    const possible = applications.filter(app => companyKey(app.company, policy) === companyKey(job.company, policy)
      && titleKey(app.role) === titleKey(job.title));
    const candidate = possible.find(app => {
      const ids = reqs({ url: app.url, title: app.role, description: app.notes });
      return !ids.length || !job.requisition_ids.length || intersects(ids, job.requisition_ids);
    });
    if (candidate) {
      job.possible_application_status = candidate.status;
      job.review_flags.push(`Possible cross-post of your ${candidate.status} opening; compare employer requisition before evaluating again`);
    }
  }
  return jobs;
}

export function rewritePending(text, jobs, ownedUrls, formatOffer, blockedUrls = new Set()) {
  const input = text || '# Discovery pipeline\n\n## Pending\n\n## Processed\n';
  const headings = [...input.matchAll(/^##[ \t]+.*$/gm)];
  const pending = headings.find(match => /^##\s+Pending\s*$/i.test(match[0]));
  if (!pending) throw new Error('Pipeline has no recognizable Pending section; refusing to rewrite it');
  const after = pending.index + pending[0].length;
  const next = headings.find(match => match.index > pending.index)?.index ?? input.length;
  const body = input.slice(after, next);
  const savedNotes = new Map();
  for (const line of body.split(/\r?\n/)) {
    const url = /^-\s*\[ \]\s+(https?:\/\/\S+)/.exec(line)?.[1];
    if (!url || !ownedUrls.has(safeUrl(url))) continue;
    const notes = [...line.matchAll(/\|\s*note:\s*([^|]+)/g)].map(m => m[1].trim())
      .map(note => note.replace(/^Discovery rank \d+;.*?job-[a-f0-9]+(?:; possible cross-post of [^;]+)?(?:;\s*)?/, '').trim()).filter(Boolean);
    if (notes.length) savedNotes.set(safeUrl(url), unique([...(savedNotes.get(safeUrl(url)) || []), ...notes]));
  }
  const blocked = new Set(blockedUrls);
  for (const match of input.matchAll(/^-\s*\[[xX]\]\s+(https?:\/\/\S+)/gm)) blocked.add(safeUrl(match[1]));
  const processed = headings.find(match => /^##\s+Processed\s*$/i.test(match[0]));
  if (processed) for (const match of input.slice(processed.index).matchAll(/https?:\/\/[^\s|)>]+/g)) blocked.add(safeUrl(match[0]));
  const manual = body.split(/\r?\n/).filter(line => {
    const match = /^-\s*\[ \]\s+(https?:\/\/\S+)/.exec(line);
    return !match || !ownedUrls.has(safeUrl(match[1]));
  }).filter(line => !line.startsWith('<!-- discovery:') && !line.startsWith('<!-- /discovery:'));
  const manualUrls = new Set(manual.flatMap(line => [...line.matchAll(/https?:\/\/[^\s|)>]+/g)].map(match => safeUrl(match[0]))));
  const entries = jobs.filter(job => job.disposition !== 'excluded' && !job.application_status && !job.sources.some(source => [source.url, source.direct_url].some(url => blocked.has(safeUrl(url))))
    && !blocked.has(job.canonical_url) && !manualUrls.has(job.canonical_url));
  const usedNotes = new Set();
  const lines = entries.map((job, i) => {
    const notes = [];
    for (const url of [job.canonical_url, ...job.sources.flatMap(s => [s.url, s.direct_url])].map(safeUrl)) {
      if (savedNotes.has(url)) { notes.push(...savedNotes.get(url)); usedNotes.add(url); }
    }
    return formatOffer({ url: job.canonical_url, company: job.company, title: job.title,
      location: job.location, postedAt: job.postedAt ? Date.parse(`${job.postedAt}T00:00:00Z`) : undefined,
      note: `Discovery rank ${i + 1}; ${job.family}; priority ${job.priority_score}/100; ${job.sources.length} source listing(s); ${job.id}${job.possible_application_status ? `; possible cross-post of ${job.possible_application_status} opening — verify requisition` : ''}` })
        + unique(notes).map(note => ` | note: ${note}`).join('');
  });
  // If a role leaves the queue, keep personal notes as prose, never requeue it.
  for (const [url, notes] of savedNotes) if (!usedNotes.has(url)) manual.push(`Saved discovery notes for ${url}: ${notes.join('; ')}`);
  return input.slice(0, after) + '\n\n<!-- discovery: managed ranked candidates; details in data/discovery/shortlist.md -->\n'
    + lines.join('\n') + '\n<!-- /discovery: managed candidates -->\n' + manual.join('\n').replace(/^\s+|\s+$/g, '') + '\n\n' + input.slice(next);
}
