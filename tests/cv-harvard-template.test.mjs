import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listTemplates, resolveTemplate, validateTemplate, DEFAULT_TEMPLATES_DIR } from '../cv-templates.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';
import { parseBlocks } from '../web/src/lib/cv-studio/html-blocks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'templates/cv-template.harvard.html');

test('Harvard Style is discoverable and resolves through the original template registry', () => {
  const entry = listTemplates('cv', { dir: DEFAULT_TEMPLATES_DIR }).find(item => item.name === 'harvard');
  assert.equal(entry?.displayName, 'Harvard Style');
  assert.equal(resolveTemplate('cv', 'harvard'), template);
  assert.equal(validateTemplate(template, 'cv').ok, true);
});

test('the original builder produces an editable, ATS-readable Harvard-style CV', t => {
  const base = path.join(root, 'output/harvard-template-tests');
  fs.mkdirSync(base, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(base, 'fixture-'));
  t.after(() => {
    assert.ok(path.resolve(scratch).startsWith(path.resolve(base) + path.sep));
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const payload = {
    lang: 'en', page_format: 'a4',
    candidate: { name: 'Alex Example', email: 'alex@example.com', phone: '+1 202 555 0100', location: 'Example City' },
    summary: 'Computer Science student building Java APIs and cloud-hosted Python services.',
    competencies: ['Java', 'Python'],
    experience: [{ company: 'Example Company', role: 'Support Intern', dates: '2025 - 2026', bullets: ['Documented support incidents and API troubleshooting.'] }],
    projects: [{ name: 'Sample Platform', description: 'Built a Java API with SQL persistence.' }],
    education: [{ title: 'BS Computer Science', org: 'Example University', year: '2027 (expected)' }],
    skills: [{ category: 'Languages', items: ['Java', 'Python', 'SQL'] }],
  };
  const input = path.join(scratch, 'payload.json');
  const output = path.join(scratch, 'cv.html');
  fs.writeFileSync(input, JSON.stringify(payload));
  const env = { ...process.env, CAREER_OPS_ROOT: scratch, CAREER_OPS_TRACKER: '', CAREER_OPS_PROFILE: '' };
  execFileSync(process.execPath, [path.join(root, 'build-cv-html.mjs'), input, output, template], { cwd: root, env, windowsHide: true });
  const rendered = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(rendered, /\{\{[A-Z_]+\}\}/);
  assert.match(rendered, /Alex Example/);
  const blocks = parseBlocks(rendered);
  assert.deepEqual(blocks.sections.map(section => section.kind), ['education', 'skills', 'projects', 'experience']);
  // A legacy payload must not restore sections this template deliberately omits.
  assert.doesNotMatch(rendered, /summary-text|competencies-grid|Professional Summary|Core Competencies/);
  assert.equal(blocks.sections.find(section => section.kind === 'experience').items[0].bullets[0].text, payload.experience[0].bullets[0]);
  const ats = JSON.parse(execFileSync(process.execPath, [path.join(root, 'verify-ats.mjs'), output, '--min-score', '80', '--json'], { cwd: root, env, windowsHide: true, encoding: 'utf8' }));
  assert.equal(ats.pass, true);
  assert.equal(ats.issues.some(issue => issue.id === 'hidden-text'), false);
});

test('omitted optional sections preserve the complete template document', () => {
  const source = fs.readFileSync(template, 'utf8');
  const stripped = stripEmptySections(source, { summary: '', competencies: [], experience: [{ company: 'Canary' }], projects: [], education: [], certifications: [], awards: [], skills: [] }, 'html');
  assert.match(stripped, /\{\{EXPERIENCE\}\}/);
  assert.doesNotMatch(stripped, /<!-- (?:PROFESSIONAL SUMMARY|CORE COMPETENCIES|PROJECTS|EDUCATION|CERTIFICATIONS|AWARDS|SKILLS) -->/);
  assert.ok(stripped.trimEnd().endsWith('</body>\n</html>'));
});
