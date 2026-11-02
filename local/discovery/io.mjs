import fs from 'node:fs';
import path from 'node:path';
import { scanHistoryDataLines, parseScanHistoryLine } from '../../lib/scan-history-columns.mjs';
import { safeUrl, observationKey } from './engine.mjs';
import { parseTrackerRow, resolveColumns } from '../../tracker-parse.mjs';

export const readJson = (file, fallback = null) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : fallback;
export const readText = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
export function filesNamed(root, name) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesNamed(full, name) : entry.name === name ? [full] : [];
  });
}

export function loadNative(root) {
  const history = scanHistoryDataLines(readText(path.join(root, 'data/scan-history.tsv'))).filter(Boolean).map(parseScanHistoryLine);
  const accepted = new Set(history.filter(row => row.status === 'added').map(row => safeUrl(row.url)));
  const latest = new Map();
  for (const row of history) if (accepted.has(safeUrl(row.url))) {
    const key = safeUrl(row.url);
    latest.set(key, { ...row, posted_at: row.posted_at || latest.get(key)?.posted_at });
  }
  const descriptions = new Map();
  for (const manifest of filesNamed(path.join(root, 'output'), 'enrichment-results.json')) {
    for (const item of readJson(manifest, [])) {
      if (!item.jd_file || item.jd_status !== 'retrieved') continue;
      const jd = path.resolve(path.dirname(manifest), item.jd_file);
      const relative = path.relative(root, jd);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(jd)) continue;
      const text = readText(jd);
      if (text.length > (descriptions.get(safeUrl(item.url))?.length || 0)) descriptions.set(safeUrl(item.url), text);
    }
  }
  const rows = [...latest.values()].map(row => ({
    source: `native:${row.portal || 'unknown'}`, source_id: safeUrl(row.url), url: row.url,
    company: row.company, title: row.title, location: row.location, description: descriptions.get(safeUrl(row.url)) || '',
    requisition_id: row.requisition_id || '', first_seen_at: history.find(old => safeUrl(old.url) === safeUrl(row.url))?.first_seen || row.first_seen,
    observed_at: row.first_seen, posted_at: row.posted_at || null,
    status: row.status === 'skipped_expired' ? 'expired' : 'observed-in-native-scan',
    evidence_file: path.join(root, 'data/scan-history.tsv'),
  }));
  return { rows, diagnostics: { source: 'native', mode: 'saved scanner history', records: rows.length } };
}

export function loadJobSpy(project) {
  const rows = [], runs = [], errors = [];
  const summaries = filesNamed(path.join(project, 'output'), 'summary.json').sort();
  for (const file of summaries) {
    const summary = readJson(file);
    const resultFile = path.join(path.dirname(file), 'unique-results.json');
    if (!fs.existsSync(resultFile)) { errors.push({ file, error: 'Completed summary has no result file' }); continue; }
    const jobs = readJson(resultFile);
    if (!Array.isArray(jobs)) throw new Error(`Expected JobSpy result array: ${resultFile}`);
    runs.push({ file, started_at: summary.started_at, finished_at: summary.finished_at,
      raw_records: summary.raw_records, unique_listings: summary.unique_listings,
      queries_with_errors: summary.queries_with_errors, queries_at_result_limit: summary.queries_at_result_limit || 0,
      result_budgets: summary.results_per_query_per_site, query_runs: summary.query_runs });
    for (const job of jobs) rows.push({
      source: `jobspy:${job.site}`, source_id: job.id || job.job_url, url: job.job_url, direct_url: job.job_url_direct,
      company: job.company, title: job.title, location: job.location, description: job.description || '',
      observed_at: job.observed_at || summary.finished_at, first_seen_at: job.observed_at || summary.finished_at,
      description_captured_at: job.description_captured_at,
      posted_at: job.date_posted || null, is_remote: job.is_remote, job_type: job.job_type,
      status: 'observed-in-jobspy-search', discovery_queries: job.discovery_queries || [job.discovery_query].filter(Boolean), evidence_file: resultFile,
    });
  }
  return { rows, diagnostics: { source: 'jobspy', mode: 'saved search outputs', runs, errors, records: rows.length } };
}

function md(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/\[/g, '\\[').replace(/\]/g, '\\]'); }
const link = (label, url) => `[${md(label)}](<${safeUrl(url)}>)`;
const family = value => ({ java_backend: 'Java / backend', cloud_devops: 'Cloud / DevOps', ai_ml: 'AI / ML' }[value] || value);

export function renderShortlist(index) {
  const included = index.listings.filter(job => job.disposition !== 'excluded');
  const excluded = index.listings.filter(job => job.disposition === 'excluded');
  const lines = ['# Your internship shortlist', '',
    `Updated ${index.generated_at_manila}. Discovery only: application forms, submissions, uploads and outreach are disabled.`, '',
    `**${included.length} ranked leads** from ${index.metrics.canonical_roles} distinct role records and ${index.metrics.source_observations} distinct source listings. `
      + `${index.metrics.duplicate_source_listings} duplicate source listings were joined with evidence. ${excluded.length} records are excluded from the priority queue.`, '',
    'Java/backend, cloud/DevOps and AI scores use your saved preferences. Priority is an explainable local search score, not an application-success prediction or a formal career-ops evaluation.', '',
    `Spring Boot is explicitly mentioned in ${included.filter(job => job.spring_boot_mentioned).length} ranked leads. Java-only roles are labelled accordingly.`, '',
    '[All records as CSV](./listings.csv) · [Complete index and source links](./listings.json) · [Source/run diagnostics](./source-status.json)', '',
    '## Ranked leads', '', '| Rank | Company / role | Track | Priority | Sources | Key checks |', '| --- | --- | --- | --- | --- | --- |'];
  if (index.last_refresh_failed) lines.splice(4, 0, '**Source warning:** the latest refresh was incomplete or failed for a source. Saved results were retained; inspect source diagnostics before treating them as fresh.', '');
  included.forEach((job, i) => lines.push(`| ${i + 1} | **${md(job.company)}** — ${link(job.title, job.canonical_url)} | ${family(job.family)} | ${job.priority_score}/100 | ${md([...new Set(job.sources.map(source => source.source))].join(', '))} | ${md(job.review_flags.slice(0, 3).join('; ') || 'Review the full listing before applying')} |`));
  lines.push('', '## Details and original sources', '');
  for (const [i, job] of included.entries()) {
    lines.push(`### ${i + 1}. ${md(job.company)} — ${md(job.title)}`, '',
      `Priority **${job.priority_score}/100** · ${md(job.location)} · ${job.disposition === 'review' ? 'Eligibility/scope review required' : 'Discovery lead; eligibility not guaranteed'}`, '',
      `Scores: Java/backend ${job.role_scores.java_backend}, cloud/DevOps ${job.role_scores.cloud_devops}, AI/ML ${job.role_scores.ai_ml}.`, '',
      `Why it surfaced: ${md(job.reasons.join('; ') || 'Technical internship evidence requires review')}.`, '',
      ...job.review_flags.map(flag => `- ${md(flag)}`), '',
      `Hours stated: ${job.stated_hours.join(', ') || 'unknown'}${job.extension_explicit ? '; extension language found in the description' : ''}. Start: ${job.stated_start_month || 'unconfirmed'}.`, '',
      `Observed: ${md(job.last_seen_at)}. Posting dates: ${md(job.posted_dates.join(', ') || 'unknown')}. Observed listings are not individual liveness guarantees.`, '',
      'Original source links:', '',
      ...job.sources.map(source => `- ${link(source.source, source.url)}${source.direct_url && source.direct_url !== source.url ? ` · ${link('employer link', source.direct_url)}` : ''}`), '',
      `Duplicate handling: ${md(job.dedup_evidence.join('; ') || 'single source listing')}. Record: \`${job.id}\`.`, '');
  }
  lines.push('## Excluded results (retained for review)', '', '| Company | Listing | Reason |', '| --- | --- | --- |');
  for (const job of excluded) lines.push(`| ${md(job.company)} | ${link(job.title, job.canonical_url)} | ${md(job.exclusion_reason)} |`);
  lines.push('', '## How to refresh', '', 'Run `node local/discovery/run.mjs --refresh` from the career-ops folder. Run without `--refresh` to rebuild from saved results. No applications are sent.', '',
    'Unknown hours, allowance and MOA are flagged rather than used as hard search exclusions. Separate requisitions remain separate. Possible duplicates without sufficient evidence retain a review flag.', '');
  return lines.join('\n');
}

export function renderCsv(jobs) {
  const fields = ['id', 'disposition', 'company', 'title', 'location', 'family', 'priority_score', 'spring_boot_mentioned', 'java_mentioned', 'canonical_url', 'source_links', 'review_flags', 'exclusion_reason'];
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [fields.join(','), ...jobs.map(job => fields.map(field => cell(field === 'source_links' ? job.sources.map(source => source.url).join('; ')
    : field === 'review_flags' ? job.review_flags.join('; ') : job[field])).join(','))].join('\n') + '\n';
}

export function ownedUrlSet(observations) {
  return new Set(observations.flatMap(row => [safeUrl(row.url), safeUrl(row.direct_url)]).filter(Boolean));
}

export function trackedUrls(file) {
  // Preserve tracker state: this module never adds, deletes or edits tracker rows.
  return new Set([...readText(file).matchAll(/https?:\/\/[^\s|)>]+/g)].map(match => safeUrl(match[0])).filter(Boolean));
}

export function trackedApplications(file) {
  const lines = readText(file).split(/\r?\n/), columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}
