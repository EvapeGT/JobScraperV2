import { postingTime } from './sort.mjs';
const $ = selector => document.querySelector(selector);
const labels = { java_backend: 'Java / Backend', cloud_devops: 'Cloud / DevOps', ai_ml: 'AI / ML' };
const sourceLabel = source => source === 'jobstreet:api' ? 'JobStreet Philippines' : source === 'jobspy:indeed' ? 'Indeed · JobSpy' : source === 'jobspy:linkedin' ? 'LinkedIn · JobSpy' : `Company source · ${source.replace(/^native:/, '').replace(/-api$/, '')}`;
const state = { data: null, token: null, track: 'all', selected: null, mobile: false, running: false, lastRun: null, poll: null };
const externalIcon = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 3h6v6m0-6-8 8M8 4H4v12h12v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
function date(value, detailed = false) { const parsed = typeof value === 'number' ? value : Date.parse(value); if (!value || !Number.isFinite(parsed)) return 'Not recorded'; return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...(detailed ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(parsed)); }
function notice(message, kind = '', retry = false) { const node = $('#notice'); node.replaceChildren(el('span', '', message)); node.className = `notice ${kind}`; node.hidden = !message; if (retry) { const button = el('button', '', 'Reload data'); button.onclick = load; node.append(button); } }
async function request(url, options) { const response = await fetch(url, options); let body; try { body = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Reload the page.'); } if (!response.ok) throw new Error(body.error || 'The local server could not complete this request.'); return body; }
function tag(text, kind = '') { return el('span', `tag ${kind}`, text); }
function jobTags(job) {
  const tags = [tag(labels[job.family] || 'Other role')];
  if (job.application_status) tags.push(tag(job.application_status, 'positive'));
  else if (job.possible_application_status) tags.push(tag(`Possible ${job.possible_application_status} cross-post`, 'review'));
  if (job.spring_boot_mentioned) tags.push(tag('Spring Boot', 'positive'));
  if (job.disposition === 'review') tags.push(tag('Needs review', 'review'));
  if (job.disposition === 'excluded') tags.push(tag('Excluded', 'review'));
  if (job.possible_duplicate_ids?.length) tags.push(tag('Possible duplicate', 'review'));
  if (job.sources?.length > 1) tags.push(tag(`${job.sources.length} source records`));
  return tags;
}
function currentFilters() { return { query: $('#search').value.toLowerCase().trim(), view: $('#view').value, source: $('#source').value, sort: $('#sort').value, spring: $('#spring').checked }; }
function filtered(ignoreTrack = false) {
  const f = currentFilters();
  return (state.data?.index?.listings || []).filter(job => {
    if (f.view === 'ranked' && job.disposition === 'excluded') return false;
    if (['review', 'excluded'].includes(f.view) && job.disposition !== f.view) return false;
    if (!ignoreTrack && state.track !== 'all' && job.family !== state.track) return false;
    if (f.spring && !job.spring_boot_mentioned) return false;
    if (f.source !== 'all' && !job.sources.some(s => f.source === 'native' ? s.source.startsWith('native:') : s.source === f.source)) return false;
    return !f.query || f.query.split(/\s+/).every(term => `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase().includes(term));
  }).sort((a, b) => f.sort === 'recent' ? postingTime(b) - postingTime(a) || (!postingTime(a) && !postingTime(b) ? (b.firstDiscoveredAt || '').localeCompare(a.firstDiscoveredAt || '') : 0) || a.id.localeCompare(b.id) : f.sort === 'company' ? a.company.localeCompare(b.company) || a.title.localeCompare(b.title) : b.priority_score - a.priority_score || a.company.localeCompare(b.company));
}
function clearFilters() { $('#search').value = ''; $('#view').value = 'ranked'; $('#source').value = 'all'; $('#sort').value = 'recent'; $('#spring').checked = false; setTrack('all'); }
function setTrack(track) { state.track = track; document.querySelectorAll('[data-track]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.track === track))); state.mobile = false; render(); }
function showEmpty(container, title, body, reset = false) { const box = el('div', 'empty-state'); box.append(el('strong', '', title), el('p', '', body)); if (reset) { const button = el('button', 'text-button', 'Clear filters'); button.onclick = clearFilters; box.append(button); } container.append(box); }
function render() {
  const jobs = filtered(), f = currentFilters(), list = $('#job-list'); list.replaceChildren();
  const sortLabel = f.sort === 'recent' ? 'newest posted first' : f.sort === 'company' ? 'company A–Z' : 'ranked by fit';
  const noun = f.view === 'all' ? 'records' : f.view === 'excluded' ? 'excluded roles' : jobs.length === 1 ? 'opportunity' : 'opportunities';
  $('#result-count').textContent = `${jobs.length} ${noun} · ${sortLabel}`;
  const trackCounts = filtered(true);
  document.querySelectorAll('[data-track]').forEach(button => { button.querySelector('span').textContent = button.dataset.track === 'all' ? trackCounts.length : trackCounts.filter(job => job.family === button.dataset.track).length; });
  $('#clear').hidden = !f.query && f.view === 'ranked' && f.source === 'all' && !f.spring && state.track === 'all' && f.sort === 'recent';
  if (!jobs.some(job => job.id === state.selected)) { state.selected = jobs[0]?.id || null; state.mobile = false; }
  if (!jobs.length) showEmpty(list, f.spring ? 'No Spring Boot matches in this view' : 'No matching internships', f.spring ? 'Try all tracks or clear filters. Java roles are kept separate until Spring Boot is explicitly mentioned.' : 'Try another company, skill, track or source. Excluded roles are available under Show → All records.', true);
  for (const job of jobs) {
    const button = el('button', 'job-row'); button.dataset.id = job.id; button.setAttribute('aria-current', String(state.selected === job.id));
    button.setAttribute('aria-label', `${job.title} at ${job.company}, fit score ${job.priority_score} of 100${job.disposition === 'review' ? ', needs review' : ''}`);
    const top = el('span', 'row-top'), score = el('span', 'row-score', `${job.priority_score}`); score.append(el('small', '', ' / 100'));
    top.append(el('span', 'row-company', job.company), score);
    const tags = el('span', 'row-meta'); tags.append(...jobTags(job));
    button.append(top, el('span', 'row-title', job.title), el('span', 'row-location', job.location || 'Location needs confirmation'),
      el('span', 'row-location', `${postingTime(job) ? `Posted ${date(postingTime(job))}` : 'Posting date unavailable'} · ${[...new Set(job.sources.map(s => sourceLabel(s.source)))].join(', ')}`), tags);
    button.onclick = () => { state.selected = job.id; state.mobile = true; document.querySelectorAll('.job-row').forEach(row => row.setAttribute('aria-current', String(row.dataset.id === job.id))); renderDetail(job); if (matchMedia('(max-width:760px)').matches) { $('#detail').scrollIntoView({ block: 'start' }); $('#detail').focus({ preventScroll: true }); } };
    list.append(button);
  }
  renderDetail(jobs.find(job => job.id === state.selected));
}
function section(title, className = '') { const node = el('section', className); node.append(el('h3', '', title)); return node; }
function bullets(items, className = 'fit-list') { const list = el('ul', className); for (const item of items || []) list.append(el('li', '', item)); return list; }
function listingLink(url, text, className = '') { const link = el('a', className, text); link.href = safeUrl(url); link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }
function renderDetail(job) {
  const detail = $('#detail'); detail.replaceChildren(); detail.classList.toggle('mobile-open', state.mobile && !!job); $('.browser-grid').classList.toggle('has-detail', state.mobile && !!job);
  if (!job) { detail.append(el('p', 'empty-detail', 'Select a different view or clear filters to find more opportunities.')); return; }
  const back = el('button', 'back-button', 'Back to opportunities'); back.onclick = () => { state.mobile = false; detail.classList.remove('mobile-open'); $('.browser-grid').classList.remove('has-detail'); $('#results').focus(); }; detail.append(back);
  const heading = el('div', 'detail-head'), title = el('div'); title.append(el('p', 'detail-company', job.company), el('h2', '', job.title), el('p', 'detail-location', `${job.location || 'Location unconfirmed'}${job.is_remote ? ' · Remote' : ''}`));
  const score = el('div', 'score-stamp'); score.append(el('strong', '', String(job.priority_score)), el('span', '', 'fit score / 100')); heading.append(title, score); detail.append(heading);
  const tags = el('div', 'row-meta'); tags.append(...jobTags(job)); detail.append(tags);
  const actions = el('div', 'detail-actions'); if (safeUrl(job.canonical_url)) { const link = listingLink(job.canonical_url, 'Open original listing', 'primary'); const icon = el('span'); icon.innerHTML = externalIcon; link.append(icon); actions.append(link); }
  actions.append(el('span', 'explanation', `${postingTime(job) ? `Posted ${date(postingTime(job))}` : 'Posting date unavailable'} · First found ${date(job.first_seen_at)} · Last seen ${date(job.last_seen_at)} · Manila time`)); detail.append(actions);
  const fit = section('Why it made your list');
  if (job.disposition === 'excluded') { fit.firstChild.textContent = 'Why it was excluded'; fit.append(el('p', 'description', job.exclusion_reason || 'Does not meet current search preferences.')); }
  else fit.append(bullets(job.reasons?.length ? job.reasons : ['Review the original role scope and requirements.']));
  const breakdown = el('div', 'score-breakdown'); for (const [family, label] of Object.entries(labels)) { const item = el('span', '', `${label} `); item.append(el('strong', '', String(job.role_scores?.[family] || 0))); breakdown.append(item); } fit.append(breakdown, el('p', 'explanation', 'Explainable role and keyword scoring, weighted by your search priorities. Scores are search guidance; check the actual role and assigned stack.')); detail.append(fit);
  const flags = [...(job.review_flags || [])];
  if (job.stated_hours?.length) flags.unshift(`Advertised hours: ${job.stated_hours.join(', ')}. Your school requirement is ${state.data.preferences.hours} hours.`);
  if (job.stated_start_month) flags.unshift(`Advertised start month: ${job.stated_start_month}`);
  if (job.hours_evidence) flags.push(job.hours_evidence);
  if (flags.length) { const review = section('Confirm before applying', 'review-section'); review.append(bullets([...new Set(flags)], 'flag-list')); detail.append(review); }
  if (job.possible_duplicate_ids?.length) {
    const possible = section('Possible related listings'); possible.append(el('p', 'sources-note', 'These stayed separate because there is not enough evidence to merge them.'));
    for (const id of job.possible_duplicate_ids) { const other = state.data.index.listings.find(x => x.id === id); if (other && safeUrl(other.canonical_url)) { const paragraph = el('p', 'sources-note'); paragraph.append(listingLink(other.canonical_url, `${other.company} · ${other.title}`)); possible.append(paragraph); } }
    detail.append(possible);
  }
  const description = section('Role description'); description.append(el('div', 'description', job.description || 'A full description was not available in the saved results. Open the original listing to confirm responsibilities, technology and eligibility.')); detail.append(description);
  const sources = section('Sources & observation history'), sourceList = el('ul', 'source-links');
  for (const source of job.sources || []) {
    const item = el('li'); if (safeUrl(source.url)) item.append(listingLink(source.url, sourceLabel(source.source)));
    if (safeUrl(source.direct_url) && source.direct_url !== source.url) { item.append(document.createTextNode(' · '), listingLink(source.direct_url, 'Employer link')); }
    item.append(el('small', '', `Observed ${date(source.observed_at, true)}${source.posted_at ? ` · Posted ${date(source.posted_at)}` : ''}${source.description_available ? '' : ' · Full description unavailable'}`)); sourceList.append(item);
  }
  sources.append(sourceList, el('p', 'sources-note', `First seen ${date(job.first_seen_at)}. Search results can change; confirm availability on the original page.`));
  if (job.dedup_evidence?.length) { const evidence = el('details'); evidence.append(el('summary', '', 'How duplicates were consolidated'), bullets(job.dedup_evidence, 'evidence-list')); sources.append(evidence); }
  detail.append(sources); detail.scrollTop = 0;
}
function overview() {
  const index = state.data?.index, box = $('#overview'); box.replaceChildren();
  if (!index) return;
  for (const [key, label] of [['ranked_leads', 'ranked leads'], ['review_leads', 'need a closer look'], ['duplicate_source_listings', 'duplicate records merged'], ['canonical_roles', 'total roles']]) { const item = el('span'); item.append(el('strong', '', String(index.metrics[key] ?? 0)), document.createTextNode(label)); box.append(item); }
  box.append(el('span', 'spring-stat', index.metrics.spring_boot_ranked ? `${index.metrics.spring_boot_ranked} ranked roles mention Spring Boot` : 'No verified Spring Boot internship match yet'));
}
function diagnostics() {
  const sources = state.data.sources, content = $('#diagnostics-content'); content.replaceChildren();
  $('#source-summary').textContent = sources.failed ? 'Latest search had issues · saved results retained' : sources.native || sources.jobspy ? 'Latest source runs completed' : 'No search receipts yet';
  const grid = el('div', 'diagnostic-grid'), native = el('section'), spy = el('section'); native.append(el('h3', '', 'Career-ops · Company sources'));
  const receipt = sources.native?.receipt;
  native.append(el('p', '', receipt ? `${receipt.scanned} sources scanned · ${receipt.found} listings returned before screening · ${receipt.errors?.length || 0} reported errors.` : 'No company-source receipt saved yet. Refresh listings to search.'));
  if (sources.native && (sources.native.exit_code !== 0 || sources.native.timed_out)) native.append(el('p', '', 'The latest company-source search did not finish successfully. Saved records are still included.'));
  native.append(el('p', 'sources-note', 'Uses the configured company and ATS sources. This is a bounded search, not every company in Metro Manila.'));
  spy.append(el('h3', '', 'JobSpy · Indeed & LinkedIn'));
  const jobspy = sources.jobspy;
  spy.append(el('p', '', jobspy ? `${jobspy.unique_listings ?? 'Unknown'} unique listings in the latest saved JobSpy run · ${jobspy.queries_with_errors ?? 0} queries with errors.` : 'No JobSpy search output saved yet.'));
  if (jobspy?.finished_at) spy.append(el('p', 'sources-note', `Last completed ${date(jobspy.finished_at, true)} · Manila time.`));
  if (jobspy?.queries?.length) {
    const table = el('table', 'query-table'), head = el('thead'), row = el('tr'); ['Source', 'Search term', 'Results'].forEach(text => { const th = el('th', '', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head); const body = el('tbody');
    for (const query of jobspy.queries) { const tr = el('tr'); tr.append(el('td', '', query.site), el('td', '', query.query), el('td', '', query.status === 'answered' ? String(query.count) : `${query.status || 'error'} (${query.count || 0})`)); body.append(tr); } table.append(body); spy.append(table);
  }
  if (jobspy?.queries_at_result_limit) spy.append(el('p', 'sources-note', `${jobspy.queries_at_result_limit} searches reached their result budget; more listings may exist.`));
  const street = el('section'), jobstreet = sources.jobstreet;
  street.append(el('h3', '', 'JobStreet Philippines'));
  street.append(el('p', '', jobstreet ? `${jobstreet.records} source records · ${jobstreet.full_descriptions} relevant descriptions available · ${jobstreet.errors.length} reported issues.` : 'No completed JobStreet search yet.'));
  if (jobstreet?.queries) for (const query of jobstreet.queries) street.append(el('p', 'sources-note', `${query.query}: ${query.count} of ${query.total ?? '?'} records${query.complete ? '' : ' · partial search'}`));
  if (jobstreet?.errors?.length) street.append(el('p', 'sources-note', jobstreet.errors.map(item => item.error).join('; ')));
  grid.append(native, spy, street); content.append(grid, el('p', 'sources-note', sources.note));
}
async function load() {
  try {
    const data = await request('/api/data'); state.data = data; state.token = data.token;
    $('#refresh').disabled = state.running;
    $('#updated').textContent = data.index ? `Updated ${date(data.index.generated_at, true)} · Manila` : 'No saved results yet';
    $('#hours-context').textContent = `${data.preferences.hours} school hours · Confirm with HR`;
    const latest = data.preferences.latest_start_month;
    $('#start-context').textContent = `Start now – ${new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${latest}-01T00:00:00Z`))}`;
    if (data.sources.failed || data.index?.last_refresh_failed) notice('The last refresh had source errors. Saved results are still shown; check source health below.', 'error');
    else if (!data.index) notice('No saved results yet. Press Refresh listings to run your first combined search.');
    else if (!state.running) notice('');
    overview(); render(); diagnostics();
  } catch (error) { notice(error.message, 'error', true); $('#updated').textContent = 'Could not load saved data'; if (!state.data) { $('#job-list').replaceChildren(); showEmpty($('#job-list'), 'Your data could not be loaded', 'Check that the local server is running, then use Reload data above.'); $('#result-count').textContent = 'Results unavailable'; } }
}
async function pollStatus() {
  try {
    const status = await request('/api/status'), wasRunning = state.running; state.running = status.running;
    $('#refresh').disabled = status.running || !state.token; $('#refresh').classList.toggle('is-refreshing', status.running); $('#refresh span').textContent = status.running ? 'Refreshing…' : 'Refresh listings';
    $('#refresh-panel').hidden = !status.running; $('#refresh-message').textContent = status.message;
    for (const [name, label] of [['native', 'Company sources'], ['jobspy', 'JobSpy'], ['jobstreet', 'JobStreet']]) $(`#${name}-progress`).textContent = `${label}: ${status.sources[name] || 'waiting'}`;
    if (status.id && !status.running && (wasRunning || state.lastRun && state.lastRun !== status.id)) {
      await load(); notice(status.message, status.phase === 'complete' ? 'success' : 'error');
    }
    state.lastRun = status.id;
    if (state.poll) clearTimeout(state.poll);
    state.poll = setTimeout(pollStatus, status.running ? 1500 : 8000);
  } catch { notice('Connection to the local server was interrupted. Your current view is still here. Run Start Internship Desk again, then reload.', 'error', true); state.poll = setTimeout(pollStatus, 8000); }
}
$('#refresh').onclick = async () => {
  $('#refresh').disabled = true;
  try { await request('/api/refresh', { method: 'POST', headers: { 'X-Desk-Token': state.token } }); notice(''); await pollStatus(); }
  catch (error) { notice(error.message, 'error'); await pollStatus(); }
};
$('#clear').onclick = clearFilters;
document.querySelectorAll('[data-track]').forEach(button => button.onclick = () => setTrack(button.dataset.track));
$('#search').addEventListener('input', () => { state.mobile = false; render(); });
for (const id of ['view', 'source', 'sort', 'spring']) $(`#${id}`).addEventListener('change', () => { state.mobile = false; render(); });
await load(); await pollStatus();
