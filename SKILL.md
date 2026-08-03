---
name: github-web
description: Add a live GitHub contribution section to a website — a 53×7 contribution heatmap, streak and activity stats, a public/private repository split bar, and pinned repository cards, all rendered from the real GitHub API into static HTML. Guides the user through GitHub API access, installing the section into their page, and setting up an automatic refresh on a server (launchd, systemd, cron, Task Scheduler or GitHub Actions). Use when the user types /github-web, or asks to put their GitHub activity, contribution graph, commit heatmap, streak, or pinned repos on their website.
---

# github-web

Puts a live GitHub channel on a website. The data is **rendered into static HTML at
build time** — no client-side JavaScript, no API call from the visitor's browser, no
token in the page. It works on a site with `Content-Security-Policy: script-src 'none'`,
and it works with no JS enabled at all.

Nothing to install in the browser. The section is HTML + CSS; a Node script rewrites the
marked-up regions in place.

---

## What the user gets

| Element | Data |
|---|---|
| Contribution heatmap | 53×7, real daily counts, GitHub's own green ramp |
| Contribution total | last 12 months |
| Current / longest streak | consecutive days ending at the last **completed** UTC day |
| Busiest day, days with commits | derived |
| Repository split bar | public vs private, widths derived from the counts |
| Pinned repo cards | the six pinned on the profile, with language dot and description |
| Recent pushes *(optional)* | last three repos by push time, with relative age |

Two viewports are supported: `data-gh-view="desktop"` and `="mobile"`. A page may carry
either or both.

---

## How to run this skill

Work through the phases in order. **Do not skip ahead to scheduling** — a scheduled job
that has never run successfully by hand is just a silent failure with a timer on it.

Ask before assuming. In particular you cannot guess: their GitHub login, where their site
lives, which machine is always on, or how their site is published.

---

## Phase 1 — Find out what you are working with

Ask, and do not proceed until you have answers:

1. **GitHub login** — the `<name>` in `github.com/<name>`.
2. **The site** — where is the HTML? Local path, and is it in git?
3. **How does it publish?** git push with a build hook, `rsync`, Cloudflare/Netlify/Vercel
   CLI, an FTP drop, or nothing (a static folder served directly)?
4. **Is there an always-on machine?** A home server, a NAS, a mini PC, a VPS. If not,
   GitHub Actions runs this for free with no machine at all — say so, it is often the
   right answer.
5. **Does the site have a Content-Security-Policy?** If it forbids inline styles
   (`style-src` without `'unsafe-inline'`), tell them now: the renderer emits inline-styled
   markup, so they need `'unsafe-inline'` or a nonce. Nothing else in this package needs
   a CSP change.

Record the answers. Several later steps depend on all five.

---

## Phase 2 — GitHub API access

Walk them through it; do not paste a token into any file they will commit.

The contribution calendar and pinned items are **GraphQL-only**. There is no REST
endpoint for either, and both require authentication even for public data.

**Option A — the `gh` CLI (simplest if they already have it):**

```bash
gh auth status          # already logged in?
gh auth token           # prints a usable token
```

That token works as-is. Good for a laptop; less good for a server, because it rotates
when they re-auth.

**Option B — a fine-grained personal access token (best for a server):**

Send them to <https://github.com/settings/personal-access-tokens/new>.

- **Repository access:** *Public repositories* is enough for public repo counts.
  To include **private** repo counts, choose *All repositories* and grant
  **Repository permissions → Metadata: Read-only**. Metadata alone is sufficient —
  they do not need code read access.
- **Account permissions:** nothing extra is required for the contribution calendar.
- **Expiry:** anything up to a year. Note the date somewhere; an expired token is the
  single most common cause of "it just stopped updating".

**The setting that silently halves the number.** GitHub excludes private contributions
from the calendar unless the profile opts in. Ask them to check
<https://github.com/settings/profile> → **Contributions** → *"Include private
contributions on my profile"*.

With it off, the total drops to public-only — in one real case 350 → 69. The tell in the
data is `restrictedContributionsCount: 0`: that field counts private contributions that
*are* included but redacted, so `0` means excluded entirely, **not** "there are none".
There is no API to change it. It is a manual setting, and only the account owner can do it.

**Verify before moving on:**

```bash
GITHUB_USER=<login> GITHUB_TOKEN=<token> node scripts/fetch-github.mjs
node scripts/validate.mjs
```

Expect a line like `OK  <login>  350 contributions  streak 8d (best 8d)  6 pinned`.
If the total looks too low, it is almost always the profile setting above.

---

## Phase 3 — Install the section

1. Copy `assets/section.html` into their page where the section should appear.
2. Copy `assets/section.css` into their stylesheet, or link it. It carries the design
   tokens it needs, so it does not depend on the rest of the source site.
3. Replace the placeholders — `YOUR_GITHUB_USERNAME` (several places) and `YOUR_TAGLINE`.
4. Fonts: the section asks for `JetBrains Mono` and a sans stack. It degrades to the
   system monospace without them. If they want the exact look, have them self-host
   JetBrains Mono rather than adding a font CDN, which most CSPs block.

**The rules to tell them, in these words:**

- **Never hand-edit anything inside a `[data-gh]` element.** Those are render targets.
  The next sync overwrites them. Style the chrome *around* them.
- **Each heatmap week column must keep its own explicit `grid-template-columns`.** It
  looks redundant and it is not: without it the implicit column resolves to `0`, all 371
  squares collapse to zero width, and the band renders as a clean empty strip with no
  error anywhere. This is the most common way the section breaks.
- **Commit `data/github-contributions.json`** in their site repo. It is the last-good
  copy that fail-closed restores from.

Then render for real:

```bash
TARGETS=path/to/index.html node scripts/render-github.mjs
```

It prints how many targets it wrote and lists any it could not find. **A missing
container is fatal and exits non-zero** — that is deliberate. Open the page and look at
it before continuing.

---

## Phase 4 — Wire up publishing

`sync.sh --publish` runs `./publish.sh` after a successful fetch, validate and render.
Copy `publish.sh.example` to `publish.sh`, make it executable, and fill in their case
from Phase 1.

Keep the guard rail in the example: it refuses to commit if the sync touched files it
should not have. A renderer bug that rewrites a whole page is caught there rather than
in production.

Test the whole chain by hand, twice, before scheduling anything:

```bash
./scripts/sync.sh --dry-run     # fetch + validate only, page untouched
./scripts/sync.sh               # ... and render
./scripts/sync.sh --publish     # ... and publish
```

---

## Phase 5 — Schedule it on the server

Pick the template in `scheduling/` that matches the always-on machine:

| Machine | File |
|---|---|
| macOS | `launchd.plist` |
| Linux | `systemd.service` + `systemd.timer` |
| Any Unix | `crontab.txt` |
| Windows | `windows-task.md` |
| **No server** | `github-actions.yml` |

**Every 8 hours (00:00 / 08:00 / 16:00) is a good default.** More often than that gains
nothing — the contribution calendar changes at most once per commit, and the section
shows day-level granularity.

Run time does not need to dodge the UTC day rollover: the streak calculation already
excludes the in-progress UTC day, so a midnight run reports what a 6am run would.

### The three things that break server installs

1. **`node` is not on the PATH.** launchd, cron and Task Scheduler all run with a
   near-empty environment and do not load a shell profile. The launchd template uses
   `bash -lc` for exactly this; the cron template sets `PATH=` explicitly.
2. **The macOS Keychain does not work under launchd.** A non-interactive session gets
   `User interaction is not allowed` (error −25308). Credentials must go in a `.env`
   file, `chmod 600`. This surprises people who tested it in a terminal, where it works
   fine.
3. **Git authentication with no human present.** Do not put a token in the remote URL or
   `.git/config`. Use a `GIT_ASKPASS` helper that reads the `.env`, or a deploy key.

After installing, **verify the schedule registered** rather than trusting it:

```bash
# macOS
launchctl print gui/$(id -u)/com.example.github-web | grep '"Hour"'
# Linux
systemctl --user list-timers github-web
```

Then force one run and read the log.

---

## Phase 6 — The host computer

The "host" is wherever they *edit* the site. Two rules, and both come from the same
failure:

**If two machines can write to the site, they will overwrite each other.**

1. **`git pull` before editing or deploying from the host.** Otherwise a hand deploy
   ships stale channel data over the server's fresher numbers.
2. **The server must pull too.** If the server renders into its own clone, that clone
   goes stale the moment the host pushes a design change — and the next scheduled run
   republishes the old page over it. Add a `git pull` at the top of `publish.sh`, or
   pull on the server after every host-side push.

If they would rather not think about this: put the schedule on **GitHub Actions**
instead. There is only ever one writer, and the problem does not exist.

---

## Troubleshooting

`docs/TROUBLESHOOTING.md` has the full list. The four that account for most of it:

| Symptom | Cause |
|---|---|
| Total looks about a fifth of what it should | Private contributions not enabled on the profile (Phase 2) |
| Heatmap is a clean empty strip, no error | A week column lost its explicit `grid-template-columns` |
| Streak reads 0 while it is obviously running | Old build counting the in-progress UTC day — fixed here, but check a fork |
| Worked in the terminal, silent under the scheduler | PATH, or the Keychain (Phase 5) |

**When something renders wrong, check the computed value, not the rule you think won.**
Two CSS rules of equal specificity are decided by file order, and a media query adds no
specificity at all — a descendant selector written outside one beats a plain class inside
one at every width.
