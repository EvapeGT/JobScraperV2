import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, mergeObservations, deduplicate, rankJob, safeUrl, rewritePending, markTrackedListings, postingTime } from './engine.mjs';
import { formatPipelineOffer } from '../../scan.mjs';
import { renderCsv, renderShortlist } from './io.mjs';

const policy = { area_aliases: ['Metro Manila', 'Manila', 'Makati', 'Taguig', 'Valenzuela'],
  role_weights: { java_backend: 1, cloud_devops: 0.9, ai_ml: 0.8 }, minimum_role_score: 35,
  company_aliases: { trendai: 'trend micro' }, body_similarity_threshold: 0.82 };
const preferences = { required_school_hours: 486, latest_start_month: '2027-01' };
const longBody = 'Develop Java REST APIs and database services. Write tests and review application code with engineers. '
  + 'Build secure backend systems using Spring Boot and SQL. Learn through real software projects under a mentor. '
  + 'Participate in debugging, testing, deployment, design and documentation of reusable server components. '
  + 'Work with teammates on application requirements and maintain code quality throughout the development lifecycle.';
function row(overrides = {}) {
  return { source: 'jobspy:indeed', source_id: 'in-1', url: 'https://ph.indeed.com/viewjob?jk=one',
    company: 'Example Inc.', title: 'Backend Developer Intern', location: 'Makati, Philippines',
    description: longBody, observed_at: '2026-10-29T10:00:00+08:00', ...overrides };
}
function job(overrides = {}) { return deduplicate([row(overrides)], policy)[0]; }
const ranked = overrides => rankJob(job(overrides), policy, preferences);

test('newest order uses posting dates, not refresh timestamps, and AI-only roles can be excluded by user policy', () => {
  const rows = [row({ source_id: 'old', posted_at: '2026-10-01', observed_at: '2026-11-01' }),
    row({ source_id: 'new', url: 'https://ph.indeed.com/viewjob?jk=new', posted_at: '2026-10-30', observed_at: '2026-10-30' })];
  const jobs = buildIndex(rows, { ...policy, sort_order: 'newest' }, preferences);
  assert.equal(jobs[0].sources[0].source_id, 'new'); assert.ok(postingTime(jobs[0]) > postingTime(jobs[1]));
  const ai = rankJob(job({ title: 'AI Engineer Intern', description: 'Develop Python machine learning models with MLflow and TensorFlow.' }),
    { ...policy, focus_families: ['java_backend', 'cloud_devops'] }, preferences);
  assert.equal(ai.disposition, 'excluded');
});

test('generic technical titles qualify for review from actual Java/API or deployment duties in descriptions', () => {
  const focused = { ...policy, focus_families: ['java_backend', 'cloud_devops'] };
  const backend = rankJob(job({ title: 'IT Intern', description: 'Exposure to Java programming. Able to make a program or application. Learn software testing and server administration. School-required internship for at least 300 hours.' }), focused, preferences);
  assert.equal(backend.disposition, 'review'); assert.equal(backend.family, 'java_backend');
  const cloud = rankJob(job({ title: 'Engineering Intern', description: 'Implement and maintain AWS cloud services. Deploy containers with Docker. Automate CI/CD pipelines and monitor production workloads. Write infrastructure tests with engineers.' }), focused, preferences);
  assert.equal(cloud.disposition, 'review'); assert.equal(cloud.family, 'cloud_devops');
  const ops = rankJob(job({ title: 'MLOps Engineer Intern', description: 'Maintain MLOps pipelines and automate deployment pipelines. Deploy cloud workloads on AWS and Azure. Monitor model services. Integrate MLflow and CI/CD, using Python.' }), focused, preferences);
  assert.equal(ops.disposition, 'review'); assert.equal(ops.family, 'cloud_devops');
});

test('company technologies and internship boilerplate do not admit unrelated or experienced jobs', () => {
  const focused = { ...policy, focus_families: ['java_backend', 'cloud_devops'] };
  for (const title of ['Senior DevOps Engineer', 'Lead Backend Developer']) {
    assert.equal(rankJob(job({ title, description: longBody + ' Our company runs an internship program. As an intern you can learn. This regular role requires 8 years of professional experience.' }), focused, preferences).disposition, 'excluded');
  }
  assert.equal(rankJob(job({ title: 'Business Development Intern', description: 'Our company builds Java applications and deploys AWS cloud services with Docker and CI/CD. Your job is sales outreach, market research and lead generation.' }), focused, preferences).disposition, 'excluded');
  assert.equal(rankJob(job({ title: 'Technical Documentation Intern', description: 'Write and maintain software documentation for APIs and databases. Describe Java code and AWS deployment pipelines.' }), focused, preferences).disposition, 'excluded');
  assert.equal(rankJob(job({ title: 'AI Engineer Intern', description: 'Develop Python machine learning models and train classifiers with TensorFlow. Knowledge of Java, databases and REST APIs is beneficial.' }), focused, preferences).disposition, 'excluded');
});

test('explicit OJT classification in a generic trainee description is retained without assuming regular trainees are interns', () => {
  const eligible = ranked({ title: 'Backend Developer Trainee', description: longBody + ' Job Type: OJT (On the job training).' });
  assert.equal(eligible.disposition, 'review');
  assert.equal(ranked({ title: 'Backend Developer Trainee', description: longBody + ' This is a regular full-time employment role.' }).disposition, 'excluded');
});

test('Philippine remote internships outside NCR need eligibility review rather than an automatic city rejection', () => {
  const remote = ranked({ title: 'Cloud Engineering Intern', location: 'Cebu, Philippines', is_remote: true, description: longBody + ' Work remotely from anywhere in the Philippines.' });
  assert.equal(remote.disposition, 'review'); assert.match(remote.location_status, /Philippines remote/);
  assert.equal(ranked({ location: 'Cebu, Philippines', is_remote: false }).disposition, 'excluded');
  assert.equal(ranked({ location: 'Singapore', is_remote: true }).disposition, 'excluded');
});

test('actual dates and full source attribution survive deduplication and Pending serialization', () => {
  const employer = 'https://example.wd3.myworkdayjobs.com/External/job/Manila/Intern_R12345';
  const rows = [row({ source: 'jobstreet:api', source_id: '12345', url: 'https://ph.jobstreet.com/job/12345', direct_url: employer, posted_at: '2026-10-30T04:00:00Z' }),
    row({ source: 'jobspy:linkedin', source_id: 'li-1', url: 'https://www.linkedin.com/jobs/view/12345', direct_url: employer, posted_at: '2026-10-28' })];
  const [merged] = buildIndex(rows, policy, preferences);
  assert.equal(merged.postedAt, '2026-10-30');
  assert.deepEqual(new Set(merged.listingSources.map(s => s.label)), new Set(['JobStreet', 'LinkedIn']));
  assert.equal(merged.applicationPlatforms[0].label, 'Workday');
  const original = '# Pipeline\n\n## Pending\n\n- [ ] ' + rows[0].url + ' | Example | Intern | note: Contact asked for school MOA\n\n## Processed\n';
  const owned = new Set([rows[0].url, employer]);
  const next = rewritePending(original, [merged], owned, formatPipelineOffer);
  assert.match(next, /posted: 2026-10-30/); assert.match(next, /note: Contact asked for school MOA/);
  assert.equal(rewritePending(next, [merged], owned, formatPipelineOffer), next);
  const excluded = rewritePending(next, [{ ...merged, disposition: 'excluded' }], owned, formatPipelineOffer);
  assert.match(excluded, /Contact asked for school MOA/); assert.ok(!excluded.includes('- [ ]'));
});

test('refresh association preserves every tracker status and personal note without requeueing exact cross-posts', () => {
  for (const status of ['Applied', 'Rejected', 'Interview', 'Assessment', 'Responded', 'Offer', 'Hired', 'Discarded', 'SKIP', 'Evaluated']) {
    const entry = { company: 'Example Inc.', role: 'Backend Developer Intern', url: row().url, status, notes: 'Personal note untouched' };
    const before = JSON.stringify(entry);
    const [tracked] = markTrackedListings(buildIndex([row()], policy, preferences), [entry], policy);
    assert.equal(tracked.application_status, status); assert.equal(JSON.stringify(entry), before);
    assert.ok(!rewritePending('# Pipeline\n\n## Pending\n\n## Processed\n', [tracked], new Set(), formatPipelineOffer).includes('- [ ]'));
  }
});

test('mixed timezone observations keep the true earliest discovery and latest observation', () => {
  const earlier = row({ observed_at: '2026-11-01T00:00:00+08:00', first_seen_at: '2026-11-01T00:00:00+08:00' });
  const later = row({ observed_at: '2026-10-31T18:00:00Z', first_seen_at: '2026-10-31T18:00:00Z' });
  const [merged] = mergeObservations([earlier], [later]);
  assert.equal(merged.observed_at, later.observed_at); assert.equal(merged.first_seen_at, earlier.first_seen_at);
});

test('a missing live description retains the saved text and its original capture date', () => {
  const original = row({ observed_at: '2026-10-20T04:00:00Z' });
  const [merged] = mergeObservations([original], [row({ description: '', observed_at: '2026-11-01T04:00:00Z' })]);
  assert.equal(merged.description, original.description);
  assert.equal(merged.description_captured_at, original.observed_at);
  assert.equal(merged.observed_at, '2026-11-01T04:00:00Z');
  const legacy = row({ observed_at: '2026-11-01T04:00:00Z' });
  const [migrated] = mergeObservations([legacy], [original, row({ description: '', observed_at: legacy.observed_at })]);
  assert.equal(migrated.description_captured_at, original.observed_at);
});

test('a verified JobStreet cross-post inherits Applied without writing or requeueing the tracker entry', () => {
  const appliedUrl = 'https://careers.example.com/jobs/req-123';
  const rows = [row({ url: appliedUrl, source: 'native:workday-api' }),
    row({ source: 'jobstreet:api', source_id: '555', url: 'https://ph.jobstreet.com/job/555', direct_url: appliedUrl })];
  const applications = [{ company: 'Example Inc.', role: 'Backend Developer Intern', url: appliedUrl, status: 'Applied' }];
  const original = JSON.stringify(applications);
  const jobs = markTrackedListings(buildIndex(rows, policy, preferences), applications, policy);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].application_status, 'Applied');
  const queue = rewritePending('# Pipeline\n\n## Pending\n\n## Processed\n', jobs, new Set(), formatPipelineOffer);
  assert.ok(!queue.includes('- [ ]')); assert.equal(JSON.stringify(applications), original);
});

test('focused discovery excludes known frontend/PHP placements but keeps unknown software stacks for review', () => {
  const focused = { ...policy, focus_families: ['java_backend', 'cloud_devops'] };
  const php = rankJob(job({ description: 'Knowledgeable in PHP and/or Node.js. Develop backend APIs and databases during this internship.' }), focused, preferences);
  assert.equal(php.disposition, 'excluded');
  const unknown = rankJob(job({ description: 'Develop software APIs and databases under a mentor. This internship accepts students.' }), focused, preferences);
  assert.equal(unknown.disposition, 'review');
  assert.notEqual(rankJob(job({ description: 'Develop Java or PHP APIs for this internship.' }), focused, preferences).disposition, 'excluded');
  for (const title of ['Mechanical Engineer Intern (Application Engineer Trainee)', 'Flutter Developer Intern', 'Programmer - Rust (On-the-Job Trainee)']) {
    assert.equal(rankJob(job({ title, description: '' }), focused, preferences).disposition, 'excluded');
  }
});

test('an explicit Workday requisition in a JobStreet title links the existing application', () => {
  const jobs = buildIndex([row({ source: 'native:workday-api', title: 'Business Application Intern',
    url: 'https://example.wd3.myworkdayjobs.com/External/job/Manila/Business-Application-Intern_R0010271' }),
    row({ source: 'jobstreet:api', source_id: '667', title: 'R0010271 Business Application Intern',
      url: 'https://ph.jobstreet.com/job/667', description: '' })], policy, preferences);
  assert.equal(jobs.length, 1); assert.ok(jobs[0].requisition_ids.includes('R0010271'));
});

test('Tracking parameters collapse; actual posting identity parameters survive', () => {
  assert.equal(safeUrl('https://ph.indeed.com/viewjob?jk=one&utm_source=x'), safeUrl('https://ph.indeed.com/viewjob?jk=one'));
  assert.notEqual(safeUrl('https://ph.indeed.com/viewjob?jk=one'), safeUrl('https://ph.indeed.com/viewjob?jk=two'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
});

test('Repeated source imports are idempotent and retain rich descriptions and original first-seen date', () => {
  const first = row({ first_seen_at: '2026-10-28' });
  const second = row({ description: '', observed_at: '2026-10-30T10:00:00+08:00' });
  const rows = mergeObservations([first], [second, second]);
  assert.equal(rows.length, 1); assert.equal(rows[0].description, longBody); assert.equal(rows[0].first_seen_at, '2026-10-28');
  const oldJobs = buildIndex([first], policy, preferences);
  assert.equal(buildIndex(rows, policy, preferences, oldJobs)[0].id, oldJobs[0].id);
});

test('Cross-board copies merge with full provenance and prefer an employer posting', () => {
  const rows = [row(), row({ source: 'jobspy:linkedin', source_id: 'li-1', url: 'https://www.linkedin.com/jobs/view/12345' }),
    row({ source: 'native:workday-api', source_id: 'native-1', url: 'https://example.wd1.myworkdayjobs.com/Jobs/job/Makati/Backend-Developer-Intern_R10001', requisition_id: 'R10001' })];
  const jobs = deduplicate(rows, policy);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].sources.length, 3);
  assert.match(jobs[0].canonical_url, /myworkdayjobs/);
  assert.ok(jobs[0].dedup_evidence.length);
});

test('Same employer requisition merges title/URL variants', () => {
  const jobs = deduplicate([row({ requisition_id: 'R1001' }), row({ source: 'native:workday-api', source_id: 'n1',
    url: 'https://careers.example.com/jobs/R1001', requisition_id: 'R1001', title: 'Backend Internship - Makati' })], policy);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].alternative_titles.length, 2);
});

test('Different known requisitions survive even with identical company, title and body', () => {
  const jobs = deduplicate([row({ requisition_id: 'R1001' }), row({ source: 'native:workday-api', source_id: 'n2',
    url: 'https://careers.example.com/jobs/R1002', requisition_id: 'R1002' })], policy);
  assert.equal(jobs.length, 2); assert.ok(jobs.every(item => !item.possible_duplicate_ids.length));
});

test('Different IDs on the same aggregator survive without authoritative matching employer evidence', () => {
  assert.equal(deduplicate([row(), row({ source_id: 'in-2', url: 'https://ph.indeed.com/viewjob?jk=two' })], policy).length, 2);
});

test('Sparse generic descriptions do not cause speculative cross-source merges', () => {
  const jobs = deduplicate([row({ description: 'Join our innovative team.' }), row({ source: 'jobspy:linkedin', source_id: 'li-2',
    url: 'https://www.linkedin.com/jobs/view/22222', description: 'Join our innovative team.' })], policy);
  assert.equal(jobs.length, 2); assert.equal(jobs[0].possible_duplicate_ids.length, 1);
});

test('Company alias is applied before duplicate comparison', () => {
  assert.equal(deduplicate([row({ company: 'TrendAI' }), row({ company: 'Trend Micro', source: 'native:workday-api', source_id: 'n3',
    url: 'https://careers.example.com/job/3' })], policy).length, 1);
});

test('Same title and description in different cities do not merge on description alone', () => {
  assert.equal(deduplicate([row(), row({ source: 'jobspy:linkedin', source_id: 'li-3', url: 'https://www.linkedin.com/jobs/view/33333',
    location: 'Taguig, Philippines' })], policy).length, 2);
});

test('Spring Boot internship leads outrank cloud/AI with configured user priorities', () => {
  const java = ranked({});
  const cloud = ranked({ title: 'DevOps Intern', description: 'Deploy AWS Docker infrastructure and automate CI/CD pipelines. Monitor production services.' });
  const ai = ranked({ title: 'AI Engineer Intern', description: 'Develop Python machine learning inference with PyTorch and model training data pipelines.' });
  assert.notEqual(java.disposition, 'excluded'); assert.ok(java.priority_score > cloud.priority_score); assert.ok(java.priority_score > ai.priority_score);
  assert.ok(java.spring_boot_mentioned);
});

test('A permanent Spring Boot developer is not admitted as an internship', () => {
  const result = ranked({ title: 'Junior Java Developer', description: longBody + ' Previous internships are advantageous. Requires two years of employment experience.' });
  assert.equal(result.disposition, 'excluded'); assert.ok(result.spring_boot_mentioned);
});

test('Full-time metadata does not reject a real internship title', () => {
  assert.notEqual(ranked({ job_type: 'fulltime' }).disposition, 'excluded');
});

test('Unknown hours are a review question and a 300-hour placement is not silently assumed extendable', () => {
  assert.ok(ranked({}).review_flags.some(flag => /486.*MOA/.test(flag)));
  const limited = ranked({ description: longBody + ' The internship lasts 300 hours.' });
  assert.notEqual(limited.disposition, 'excluded'); assert.ok(limited.review_flags.some(flag => /confirm extension/i.test(flag)));
});

test('Explicit extension is recognized and a 500-hour requirement remains flagged', () => {
  const extension = ranked({ description: longBody + ' Minimum 480 internship hours. We are open to extend longer if your academic institution requires it.' });
  assert.equal(extension.extension_explicit, true); assert.ok(!extension.review_flags.some(flag => /confirm extension/i.test(flag)));
  assert.ok(ranked({ description: longBody + ' With 500+ internship hours requirement.' }).review_flags.some(flag => /500.*486/.test(flag)));
  assert.ok(ranked({ description: longBody + ' With 500 or more internship hours requirement.' }).stated_hours.includes(500));
});

test('Broad Java/cloud technology internships remain visible with a team-allocation warning', () => {
  const result = ranked({ title: 'Manila Technology Internship Program', description: longBody + ' Software, QA or DevOps/Cloud team allocation depends on your interests.' });
  assert.notEqual(result.disposition, 'excluded'); assert.ok(result.review_flags.some(flag => /team placement/.test(flag)));
});

test('An explicitly different primary stack ranks below an otherwise equivalent Java internship', () => {
  const java = ranked({});
  const php = ranked({ title: 'Software Engineer Intern - PHP/Laravel', description: 'Build and test REST APIs and database systems using PHP and Laravel.' });
  assert.ok(java.priority_score > php.priority_score); assert.ok(php.review_flags.some(flag => /primary stack/.test(flag)));
});

test('Explicit later start and summer cohorts do not pass the January start window', () => {
  assert.equal(ranked({ description: longBody + ' Starting June 2027.' }).disposition, 'excluded');
  assert.equal(ranked({ title: 'Technology Summer Internship Philippines 2027' }).disposition, 'excluded');
  assert.notEqual(ranked({ description: longBody + ' Starting January 2027.' }).disposition, 'excluded');
});

test('Metro Manila, unknown Philippine location, and foreign remote jobs have distinct treatment', () => {
  assert.equal(ranked({ location: 'Makati, Philippines' }).location_status, 'Metro Manila');
  assert.equal(ranked({ location: 'Philippines' }).disposition, 'review');
  assert.equal(ranked({ location: 'New York, United States', is_remote: true }).disposition, 'excluded');
  assert.notEqual(ranked({ location: 'Philippines', is_remote: true }).disposition, 'excluded');
});

test('Cloud titles do not overrule a technical-documentation job description', () => {
  const result = ranked({ title: 'Cloud Ops Engineer Intern', description: 'Write technical documentation and maintain the wiki. Document AWS workflows. Review documentation and organize the knowledge base. Documentation and wiki accuracy are your responsibility.' });
  assert.equal(result.disposition, 'excluded'); assert.ok(result.review_flags.some(flag => /documentation/.test(flag)));
});

test('HR roles are not promoted merely for listing Java as a background skill', () => {
  assert.equal(ranked({ title: 'HR Intern', description: longBody }).disposition, 'excluded');
});

test('An authoritative native expiry is not overruled by an aggregator observation', () => {
  const jobs = buildIndex([row(), row({ source: 'native:workday-api', source_id: 'n1', url: 'https://careers.example.com/jobs/123', status: 'expired' })], policy, preferences);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].disposition, 'excluded');
});

test('Pipeline rewrite preserves manual/processed work, removes duplicate owned rows and is idempotent', () => {
  const [included] = buildIndex([row()], policy, preferences);
  const text = '# Pipeline\n\n## Pending\n\n- [ ] ' + included.canonical_url + ' | old copy\n- [ ] ' + included.canonical_url
    + ' | duplicate\n- [ ] https://manual.example/jobs/1 | My manual role\n\n## Processed\n\n- [x] https://done.example/jobs/1 | Done\n';
  const owned = new Set([included.canonical_url]);
  const rewritten = rewritePending(text, [included], owned, formatPipelineOffer);
  assert.equal(rewritten.split(included.canonical_url).length - 1, 1);
  assert.match(rewritten, /My manual role/); assert.match(rewritten, /\[x\] https:\/\/done.example\/jobs\/1/);
  assert.equal(rewritePending(rewritten, [included], owned, formatPipelineOffer), rewritten);
});

test('Checked and tracker-known aliases are not requeued under the canonical employer URL', () => {
  const [included] = buildIndex([row({ direct_url: 'https://careers.example.com/jobs/123' })], policy, preferences);
  const text = '# Pipeline\n\n## Pending\n\n- [x] ' + included.sources[0].url + ' | reviewed\n\n## Processed\n';
  const rewritten = rewritePending(text, [included], new Set([included.canonical_url, included.sources[0].url]), formatPipelineOffer);
  assert.ok(!rewritten.includes('- [ ]'));
  assert.ok(!rewritePending('# Pipeline\n\n## Pending\n\n## Processed\n', [included], new Set(), formatPipelineOffer,
    new Set([included.sources[0].url])).includes('- [ ]'));
});

test('Reports treat scraped text as data and CSV exports neutralize formulas', () => {
  const result = ranked({ company: '=HYPERLINK("bad")', title: 'Backend Intern <script>alert(1)</script>' });
  const csv = renderCsv([result]); assert.ok(csv.includes("'=HYPERLINK"));
  const report = renderShortlist({ generated_at_manila: 'test', metrics: { canonical_roles: 1, source_observations: 1, duplicate_source_listings: 0 }, listings: [result] });
  assert.ok(!report.includes('<script>')); assert.ok(report.includes('&lt;script&gt;'));
});
