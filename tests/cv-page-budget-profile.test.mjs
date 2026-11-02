import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pageBudgetFromProfile, resolveCvPageBudget } from '../generate-pdf.mjs';

test('page budget preserves existing defaults when no preference is configured', () => {
  assert.deepEqual(pageBudgetFromProfile(null), { maxPages: 2, strictPages: false });
  assert.deepEqual(pageBudgetFromProfile({ cv: { template: 'harvard' } }), { maxPages: 2, strictPages: false });
});

test('CV profile defaults apply; explicit options override each field independently', () => {
  const profile = { cv: { max_pages: 1, strict_pages: true } };
  assert.deepEqual(pageBudgetFromProfile(profile), { maxPages: 1, strictPages: true });
  assert.deepEqual(pageBudgetFromProfile(profile, { maxPages: 3 }), { maxPages: 3, strictPages: true });
  assert.deepEqual(pageBudgetFromProfile(profile, { strictPages: false }), { maxPages: 1, strictPages: false });
});

test('malformed CV policy fails even when explicit options could mask the typo', () => {
  for (const max_pages of [0, -1, 1.5, '1', null, true]) {
    assert.throws(() => pageBudgetFromProfile({ cv: { max_pages } }, { maxPages: 2 }), /cv\.max_pages/);
  }
  for (const strict_pages of ['true', 1, null]) {
    assert.throws(() => pageBudgetFromProfile({ cv: { strict_pages } }, { strictPages: true }), /cv\.strict_pages/);
  }
  assert.throws(() => pageBudgetFromProfile({ cv: [] }), /cv must be a mapping/);
});

test('cover letters ignore CV policy while honoring their explicit render options', () => {
  const profile = { cv: { max_pages: 'not-a-number', strict_pages: 'invalid' } };
  assert.deepEqual(pageBudgetFromProfile(profile, { kind: 'cover' }), { maxPages: 2, strictPages: false });
  assert.deepEqual(pageBudgetFromProfile(profile, { kind: 'cover', maxPages: 1, strictPages: true }), { maxPages: 1, strictPages: true });
});

test('profile reader distinguishes absence, valid YAML, malformed YAML and invalid policy', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-page-policy-')));
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const profilePath = join(root, 'profile.yml');
  assert.deepEqual(resolveCvPageBudget({ profilePath }), { maxPages: 2, strictPages: false });
  writeFileSync(profilePath, 'cv:\n  max_pages: 1\n  strict_pages: true\n');
  assert.deepEqual(resolveCvPageBudget({ profilePath }), { maxPages: 1, strictPages: true });
  writeFileSync(profilePath, 'cv: [broken');
  assert.throws(() => resolveCvPageBudget({ profilePath }), /Cannot read CV page limits/);
  writeFileSync(profilePath, 'cv:\n  max_pages: zero\n');
  assert.throws(() => resolveCvPageBudget({ profilePath }), /cv\.max_pages/);
  assert.deepEqual(resolveCvPageBudget({ profilePath, kind: 'cover' }), { maxPages: 2, strictPages: false });
});
