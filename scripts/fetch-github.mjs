#!/usr/bin/env node
/**
 * fetch-github.mjs
 *
 * Pulls the last 365 days of contribution data, profile counters and pinned
 * repositories from the GitHub GraphQL API and writes the canonical data file.
 *
 *   GITHUB_TOKEN=ghp_xxx node scripts/fetch-github.mjs
 *
 * Requires Node 18+ (global fetch). No dependencies.
 * On any failure it exits non-zero and leaves the existing data file untouched.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = resolve(ROOT, 'data/github-contributions.json');

const USER = process.env.GITHUB_USER;
if (!USER) {
  console.error('FATAL: set GITHUB_USER to your GitHub login (the name in github.com/<login>).');
  process.exit(1);
}
const TOKEN = process.env.GITHUB_TOKEN;
const LEVEL_VALUES = [0, 2, 5, 11, 19];

if (!TOKEN) {
  console.error('FATAL: GITHUB_TOKEN is not set. Needs a token with read:user scope.');
  process.exit(2);
}

const QUERY = `
query($login:String!, $from:DateTime!, $to:DateTime!) {
  user(login:$login) {
    login
    followers { totalCount }
    publicRepos: repositories(privacy:PUBLIC, ownerAffiliations:OWNER) { totalCount }
    privateRepos: repositories(privacy:PRIVATE, ownerAffiliations:OWNER) { totalCount }
    allRepos: repositories(ownerAffiliations:OWNER) { totalCount }
    contributionsCollection(from:$from, to:$to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date weekday contributionCount contributionLevel }
        }
      }
    }
    # 06 live-from-the-shop: the three most recently pushed repos.
    # ownerAffiliations:OWNER excludes repos merely collaborated on.
    # Private ones require the token's repo scope (UPDATING-FIGURES.md section 1).
    recentPushes: repositories(first:3, ownerAffiliations:OWNER, orderBy:{field:PUSHED_AT, direction:DESC}) {
      nodes { name isPrivate pushedAt url }
    }
    pinnedItems(first:6, types:REPOSITORY) {
      nodes {
        ... on Repository {
          name url description stargazerCount
          primaryLanguage { name color }
        }
      }
    }
  }
}`;

const LEVEL_MAP = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function isoDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function graphql(variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-web-sync',
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error('GraphQL errors: ' + JSON.stringify(body.errors));
  if (!body.data?.user) throw new Error(`User "${variables.login}" not found`);
  return body.data.user;
}

/** GitHub returns 53 weeks with partial first/last weeks. Pad to a clean 53x7. */
function buildMatrix(weeks) {
  const levels = [];
  const days = [];
  for (const w of weeks) {
    const lc = new Array(7).fill(0);
    const dc = new Array(7).fill(0);
    for (const d of w.contributionDays) {
      lc[d.weekday] = LEVEL_MAP[d.contributionLevel] ?? 0;
      dc[d.weekday] = d.contributionCount;
    }
    levels.push(lc);
    days.push(dc);
  }
  // normalise to exactly 53 columns
  while (levels.length > 53) { levels.shift(); days.shift(); }
  while (levels.length < 53) { levels.unshift(new Array(7).fill(0)); days.unshift(new Array(7).fill(0)); }
  return { levels, days };
}

/**
 * Chronological day counts, EXCLUDING the in-progress UTC day.
 *
 * GitHub returns today with whatever has landed so far — usually 0 in the small hours.
 * Counting it makes currentStreak read 0 for an actively-worked repo. No schedule fixes
 * this: 06:00 America/New_York is 10:00 UTC, still the same incomplete day. It has to be
 * dropped here.
 */
function flatten(weeks) {
  const out = [];
  for (const w of weeks) {
    for (const d of w.contributionDays) out.push(d.contributionCount);
  }
  return out;
}

function computeStats(flat) {
  let longest = 0, run = 0, busiest = 0, active = 0, total = 0;
  for (const v of flat) {
    total += v;
    if (v > 0) { run++; active++; if (run > longest) longest = run; } else run = 0;
    if (v > busiest) busiest = v;
  }
  /* Current streak. The in-progress day cuts BOTH ways:
       - a ZERO today must not break the streak (the day is not over)
       - a NON-ZERO today must COUNT, or the number reads one short of the
         heatmap beside it — the chart shows 10 squares, the counter says 9.
     Dropping today wholesale only fixed the first case. */
  let i = flat.length - 1;
  if (i >= 0 && flat[i] === 0) i--;   // today hasn't happened yet; not a break
  let current = 0;
  for (; i >= 0; i--) { if (flat[i] > 0) current++; else break; }
  return {
    total,
    activeDays: active,
    totalDays: flat.length,
    currentStreak: current,
    longestStreak: longest,
    busiestDay: busiest,
    // derived from the same day set as totalDays — flat excludes the in-progress day,
    // so a hard-coded 53 would disagree with activeDays / totalDays by a few days
    averagePerWeek: Math.round((total / Math.max(1, flat.length / 7)) * 10) / 10,
  };
}

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 86400000);

  const user = await graphql({ login: USER, from: isoDay(from), to: isoDay(to) });
  const cal = user.contributionsCollection.contributionCalendar;
  const { levels, days } = buildMatrix(cal.weeks);
  const flat = flatten(cal.weeks);
  const stats = computeStats(flat);

  // GitHub's own headline number wins over our recomputed sum
  stats.total = cal.totalContributions ?? stats.total;

  const pinned = user.pinnedItems.nodes.map((r) => ({
    name: r.name,
    url: r.url,
    description: (r.description || '').trim(),
    language: r.primaryLanguage?.name || 'Releases',
    languageColor: r.primaryLanguage?.color || '#fbbf4c',
    stars: r.stargazerCount || 0,
  }));

  /* Rendered at sync time, so it can drift up to a day between runs — the same
     coarse units the design uses ("2h", "1d") keep that from reading wrong. */
  const relAgo = (iso) => {
    const secs = (Date.now() - Date.parse(iso)) / 1000;
    if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    if (secs < 2592000) return `${Math.floor(secs / 86400)}d`;
    if (secs < 31536000) return `${Math.floor(secs / 2592000)}mo`;
    return `${Math.floor(secs / 31536000)}y`;
  };
  const pushes = (user.recentPushes?.nodes || []).map((r) => ({
    name: r.name,
    isPrivate: r.isPrivate,
    pushedAt: r.pushedAt,
    ago: relAgo(r.pushedAt),
    url: r.isPrivate ? null : r.url,   // a private URL 404s for visitors
  }));

  let previous = {};
  try { previous = JSON.parse(await readFile(DATA, 'utf8')); } catch {}

  const out = {
    $schema: '../schema/github-contributions.schema.json',
    source: { provider: 'github', user: user.login, profile: `https://github.com/${user.login}` },
    generated: new Date().toISOString(),
    stale: false,
    contributions: {
      range: { from: isoDay(from).slice(0, 10), to: isoDay(to).slice(0, 10) },
      levelValues: LEVEL_VALUES,
      stats,
      levels,
      days,
    },
    profile: {
      // privateRepos requires a token with the `repo` scope; without it GitHub
      // returns 0 and we keep the previous value rather than zeroing the bar.
      publicRepos: user.publicRepos.totalCount,
      privateRepos: user.privateRepos.totalCount || previous.profile?.privateRepos || 0,
      totalRepos: user.allRepos.totalCount || (user.publicRepos.totalCount + (previous.profile?.privateRepos || 0)),
      pinnedCount: pinned.length,
      followers: user.followers.totalCount,
    },
    pinned,
    pushes,
    theme: previous.theme || {
      empty: 'rgba(253,246,236,.07)',
      levels: ['#0e4429', '#006d32', '#26a641', '#39d353'],
      cell: { desktop: { size: 13, gap: 3 }, mobile: { size: 5, gap: 1 } },
    },
  };

  // data/ is gitignored in this package, so on a fresh clone it does not exist yet.
  // Without this the very first run dies on ENOENT after a successful fetch.
  await mkdir(dirname(DATA), { recursive: true });
  await writeFile(DATA, JSON.stringify(out, null, 2) + '\n');
  console.log(
    `OK  ${out.source.user}  ${stats.total} contributions  ` +
    `streak ${stats.currentStreak}d (best ${stats.longestStreak}d)  ` +
    `${pinned.length} pinned  ${pushes.length} pushes  →  data/github-contributions.json`
  );
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
