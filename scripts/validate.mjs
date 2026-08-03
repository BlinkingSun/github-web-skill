#!/usr/bin/env node
/**
 * validate.mjs — refuse to publish a malformed data file.
 *   node scripts/validate.mjs
 * Exit 0 = safe to render. Exit 1 = do not render, keep yesterday's page.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let d;
try {
  d = JSON.parse(await readFile(resolve(ROOT, 'data/github-contributions.json'), 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error('FATAL: No data file yet — run `node scripts/fetch-github.mjs` first.');
    console.error('       (needs GITHUB_USER and GITHUB_TOKEN; see docs/API-SETUP.md)');
    process.exit(1);
  }
  console.error('FATAL: data file is present but unreadable: ' + e.message);
  process.exit(1);
}
const errs = [];
const warn = [];

const c = d.contributions || {};
if (d.stale) errs.push('data is flagged stale');
if (!Array.isArray(c.levels) || c.levels.length !== 53) errs.push(`levels must be 53 columns, got ${c.levels?.length}`);
if (!Array.isArray(c.days) || c.days.length !== 53) errs.push(`days must be 53 columns, got ${c.days?.length}`);
(c.levels || []).forEach((col, i) => {
  if (col.length !== 7) errs.push(`levels[${i}] has ${col.length} rows, expected 7`);
  col.forEach((v, j) => { if (!Number.isInteger(v) || v < 0 || v > 4) errs.push(`levels[${i}][${j}] = ${v}, expected integer 0-4`); });
});
(c.days || []).forEach((col, i) => {
  col.forEach((v, j) => { if (!Number.isInteger(v) || v < 0) errs.push(`days[${i}][${j}] = ${v}, expected non-negative integer`); });
});

const s = c.stats || {};
for (const k of ['total', 'activeDays', 'totalDays', 'currentStreak', 'longestStreak', 'busiestDay']) {
  if (typeof s[k] !== 'number' || s[k] < 0) errs.push(`stats.${k} missing or negative`);
}
if (s.currentStreak > s.longestStreak) errs.push('currentStreak exceeds longestStreak');
if (s.activeDays > s.totalDays) errs.push('activeDays exceeds totalDays');
if (s.total === 0) warn.push('total is 0 — plausible, but check the token scope');

if (!Array.isArray(d.pinned) || d.pinned.length < 1 || d.pinned.length > 6) errs.push(`pinned must hold 1-6 repos, got ${d.pinned?.length}`);
(d.pinned || []).forEach((r, i) => {
  for (const k of ['name', 'url', 'language', 'languageColor']) if (!r[k]) errs.push(`pinned[${i}].${k} missing`);
  if (r.url && !r.url.startsWith('https://github.com/')) errs.push(`pinned[${i}].url is not a github.com URL`);
  if (!r.description) warn.push(`pinned[${i}] (${r.name}) has no description`);
});

const t = d.theme || {};
if (!t.empty || !Array.isArray(t.levels) || t.levels.length !== 4) errs.push('theme.levels must hold exactly 4 colours');
for (const view of ['desktop', 'mobile']) {
  const cell = t.cell?.[view];
  if (!cell) { errs.push(`theme.cell.${view} missing`); continue; }
  const width = 53 * (cell.size + cell.gap) - cell.gap;
  const budget = view === 'desktop' ? 1005 : 354;
  if (width > budget) errs.push(`${view} heatmap is ${width}px wide, container is ${budget}px — reduce cell size`);
  if (cell.size < 3) warn.push(`${view} cell size ${cell.size}px is very small`);
}

const age = (Date.now() - Date.parse(d.generated)) / 3600000;
if (Number.isFinite(age) && age > 48) warn.push(`data is ${Math.round(age)}h old — the scheduled job may not be running`);

warn.forEach((w) => console.warn('WARN ', w));
if (errs.length) { errs.forEach((e) => console.error('ERROR', e)); process.exit(1); }
console.log(`OK  53x7 matrix, ${s.total} contributions, ${d.pinned.length} pinned repos, ${Math.round(age)}h old`);
