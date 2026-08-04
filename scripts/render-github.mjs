#!/usr/bin/env node
/**
 * render-github.mjs
 *
 * Writes the contents of data/github-contributions.json into the page's
 * [data-gh="…"] containers. Rewrites nothing else.
 *
 *   node scripts/render-github.mjs ../path/to/page.html [more.html …]
 *   TARGETS="a.html,b.html" node scripts/render-github.mjs
 *
 * Idempotent: running it twice with the same data produces the same file.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = resolve(ROOT, 'data/github-contributions.json');

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (process.env.TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!targets.length) {
  console.error('Usage: node scripts/render-github.mjs <page.html> [...]');
  process.exit(2);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Number(n).toLocaleString('en-US');

/** Find an element by attribute selector and return {start, innerStart, innerEnd, end}. */
function locate(html, attrs) {
  const needle = attrs.map((a) => `[${a}]`).join('');
  const re = new RegExp('<(\\w+)((?:[^>"\']|"[^"]*"|\'[^\']*\')*?)>', 'g');
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrStr = m[2];
    if (!attrs.every((a) => {
      const eq = a.indexOf('=');
      if (eq < 0) return attrStr.includes(a);
      const k = a.slice(0, eq);
      // the caller passes the value already quoted (data-gh="heatmap"); strip those
      // quotes before re-adding them, or we search for data-gh=""heatmap"" and the
      // container is silently never found.
      const v = a.slice(eq + 1).replace(/^["']|["']$/g, '');
      return attrStr.includes(`${k}="${v}"`);
    })) continue;

    const innerStart = m.index + m[0].length;
    // walk to the balanced closing tag
    const open = new RegExp(`<${tag}\\b`, 'g');
    const close = new RegExp(`</${tag}>`, 'g');
    let depth = 1, i = innerStart;
    while (depth > 0) {
      open.lastIndex = i; close.lastIndex = i;
      const o = open.exec(html);
      const c = close.exec(html);
      if (!c) throw new Error(`unbalanced <${tag}> for ${needle}`);
      if (o && o.index < c.index) { depth++; i = o.index + 1; }
      else { depth--; i = c.index + c[0].length; if (depth === 0) return { innerStart, innerEnd: c.index, end: i }; }
    }
  }
  return null;
}

const selector = (attrs) => attrs.map((a) => `[${a}]`).join('');

function replaceInner(html, attrs, inner, report) {
  const loc = locate(html, attrs);
  if (!loc) { report.missing.push(selector(attrs)); return html; }
  report.written.push(selector(attrs));
  return html.slice(0, loc.innerStart) + inner + html.slice(loc.innerEnd);
}

function heatmap(levels, theme, view) {
  const { size, gap } = theme.cell[view];
  const colour = (l) => (l === 0 ? theme.empty : theme.levels[l - 1]);
  return levels
    .map(
      (col) =>
        `<div style="display:grid;grid-template-columns:${size}px;grid-template-rows:repeat(7,${size}px);gap:${gap}px">` +
        col.map((l) => `<i style="border-radius:2px;background:${colour(l)}"></i>`).join('') +
        `</div>`
    )
    .join('');
}

function cardDesktop(r) {
  return (
    `<a href="${r.url}" style="display:flex;flex-direction:column;gap:8px;padding:16px 18px;background:#0b090d;text-decoration:none;transition:background .16s ease" style-hover="background:rgba(253,246,236,.055)">` +
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">` +
    `<span style="font:600 14px 'JetBrains Mono',monospace;color:#fdf6ec">${esc(r.name)}</span>` +
    `<span style="font:500 10.5px 'JetBrains Mono',monospace;color:rgba(253,246,236,.4)">${r.stars ? '★ ' + r.stars : ''}</span>` +
    `</div>` +
    `<p style="margin:0;flex:1;font:400 12.5px/1.55 Archivo,sans-serif;color:rgba(253,246,236,.55);text-wrap:pretty">${esc(r.description)}</p>` +
    `<div style="display:flex;align-items:center;gap:7px;font:500 10.5px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:rgba(253,246,236,.45)">` +
    `<span style="width:8px;height:8px;border-radius:50%;background:${r.languageColor}"></span>${esc(r.language)}</div>` +
    `</a>`
  );
}

function cardMobile(r) {
  return (
    `<a href="${r.url}" style="display:flex;flex-direction:column;gap:6px;padding:13px 18px;background:#0b090d;text-decoration:none">` +
    `<span style="font:600 12.5px 'JetBrains Mono',monospace;color:#fdf6ec">${esc(r.name)}</span>` +
    `<div style="display:flex;align-items:center;gap:7px;font:500 9.5px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:rgba(253,246,236,.45)">` +
    `<span style="width:7px;height:7px;border-radius:50%;background:${r.languageColor}"></span>${esc(r.language)}</div>` +
    `</a>`
  );
}

/* 06 live-from-the-shop: visibility badge, repo name, age. Private repos are
   NOT linked — the URL 404s for anyone who is not the owner. */
function pushRow(r) {
  const inner =
    `<span class="push__vis">${r.isPrivate ? 'private' : 'public'}</span>` +
    `<span class="push__name">${esc(r.name)}</span>` +
    `<span class="push__ago">${esc(r.ago)}</span>`;
  return r.url
    ? `<a class="push" href="${r.url}">${inner}</a>`
    : `<div class="push">${inner}</div>`;
}

let d;
try {
  d = JSON.parse(await readFile(DATA, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error('FATAL: No data file yet — run `node scripts/fetch-github.mjs` first.');
    console.error('       (needs GITHUB_USER and GITHUB_TOKEN; see docs/API-SETUP.md)');
    process.exit(1);
  }
  console.error('FATAL: data file is present but unreadable: ' + e.message);
  process.exit(1);
}

// whoami_ portrait scalars — optional; absent file simply leaves the markup alone
let bio = null;
try { bio = JSON.parse(await readFile(resolve(ROOT, 'data/whoami.json'), 'utf8')); } catch {}
if (d.stale) { console.error('FATAL: data file is marked stale — run fetch-github.mjs first.'); process.exit(1); }
const s = d.contributions.stats;

for (const file of targets) {
  const path = resolve(process.cwd(), file);
  let html = await readFile(path, 'utf8');
  const report = { written: [], missing: [] };

  // A reference page carries ONE viewport's hooks (desktop.html has no mobile variants
  // and vice versa), so an absent view is normal. Only a hook with no view present at
  // all is a real failure — that is what the double-quoting bug produced.
  const resolved = { heatmap: 0, pinned: 0 };
  const bodies = {
    heatmap: (view) => heatmap(d.contributions.levels, d.theme, view),
    pinned: (view) => (view === 'desktop' ? d.pinned.map(cardDesktop) : d.pinned.slice(0, 3).map(cardMobile)).join(''),
  };
  for (const hook of ['heatmap', 'pinned']) {
    for (const view of ['desktop', 'mobile']) {
      const attrs = [`data-gh="${hook}"`, `data-gh-view="${view}"`];
      if (!locate(html, attrs)) continue;
      html = replaceInner(html, attrs, bodies[hook](view), report);
      resolved[hook]++;
    }
  }
  const absent = Object.keys(resolved).filter((h) => resolved[h] === 0);

  // 06 live-from-the-shop: the last three uploads. Single view, no data-gh-view,
  // so it sits outside the heatmap/pinned loop above. Optional — a page without
  // the hook is not an error.
  if (Array.isArray(d.pushes) && d.pushes.length && locate(html, ['data-gh="pushes"'])) {
    html = replaceInner(html, ['data-gh="pushes"'], d.pushes.map(pushRow).join(''), report);
  }

  // every [data-gh="total"] on the page (desktop headline + mobile inline)
  html = html.replace(/(<(\w+)[^>]*data-gh="total"[^>]*>)([\s\S]*?)(?=<span|<\/)/g, (_m, open) => open + num(s.total));

  const scalars = {
    'stat-currentStreak': s.currentStreak + ' days',
    'stat-longestStreak': s.longestStreak + ' days',
    'stat-busiestDay': String(s.busiestDay),
    'stat-activeDays': `${s.activeDays} / ${s.totalDays}`,
    'stat-averagePerWeek': String(s.averagePerWeek),
    repos: String(d.profile.totalRepos ?? d.profile.publicRepos),
    'repos-public': String(d.profile.publicRepos),
    'repos-private': String(d.profile.privateRepos ?? 0),
    'pinned-count': String(d.profile.pinnedCount),
    // The mobile one-liner under the handle. It carries a data-gh hook, so if it
    // is not in this map it silently keeps whatever the template shipped while
    // every counter around it updates.
    'counts-mobile': `${d.profile.totalRepos ?? d.profile.publicRepos} repos · `
      + `${d.profile.privateRepos ?? 0} private · ${d.profile.pinnedCount} pinned`,
  };
  // repository split bar — widths are derived, never authored by hand
  {
    const pub = d.profile.publicRepos, priv = d.profile.privateRepos ?? 0;
    const tot = Math.max(1, pub + priv);
    html = html.replace(/(data-gh="repos-bar-public"[^>]*style="width:)[\d.]+%/, `$1${(pub / tot * 100).toFixed(1)}%`);
    html = html.replace(/(data-gh="repos-bar-private"[^>]*style="width:)[\d.]+%/, `$1${(priv / tot * 100).toFixed(1)}%`);
  }



  for (const [tag, value] of Object.entries(scalars)) {
    const re = new RegExp(`(<(\\w+)[^>]*data-gh="${tag}"[^>]*>)[^<]*(</\\2>)`, 'g');
    if (re.test(html)) report.written.push(`[data-gh="${tag}"]`);
    html = html.replace(re, (_m, open, _t, close) => open + value + close);
  }

  /* Every data-gh hook in the page must be written by something above. A hook
     nobody writes is the worst failure mode here: it shows whatever the template
     shipped while every counter around it updates, and nothing reports it. This
     is how [data-gh="counts-mobile"] sat stale reading "19 repos" beside a bar
     that said 20 — found by a human, not by the tooling. */
  {
    const handled = new Set([...Object.keys(scalars),
      'heatmap', 'pinned', 'pushes', 'total', 'stats',
      'repos-bar', 'repos-bar-public', 'repos-bar-private']);
    const present = new Set([...html.matchAll(/data-gh="([a-zA-Z-]+)"/g)].map((m) => m[1]));
    const orphaned = [...present].filter((h) => !handled.has(h));
    if (orphaned.length) {
      console.error(`FATAL: ${file} — hooks present but never written: `
        + orphaned.map((h) => `[data-gh="${h}"]`).join(', '));
      console.error('Either render them or remove them; a stale hook is invisible.');
      process.exit(1);
    }
  }

  if (absent.length || report.missing.length) {
    const names = [...new Set([...absent.map((h) => `[data-gh="${h}"]`), ...report.missing])];
    console.error(`FATAL: ${file} — no container found for: ${names.join(', ')}`);
    console.error('Refusing to write a page with a missing heatmap or repo grid.');
    process.exit(1);
  }
  await writeFile(path, html);
  console.log(`OK  ${file}  ${report.written.length} targets written`);
}
