# Troubleshooting

Ordered by how often each one actually happens.

---

## The number is far lower than my profile shows

**Private contributions are not enabled on the profile.** See `API-SETUP.md §2`. Real
case: 350 → 69.

Confirm it from the data rather than guessing:

```bash
grep restrictedContributionsCount data/github-contributions.json
```

`0` means *excluded entirely*, not "none exist" — that field only ever counts private
contributions that **are** being included.

---

## The month labels don't line up with GitHub's graph

Before this fix, `assets/section.html` shipped the month row as literal text (`Aug`…`Jul`).
Those labels were right only on the day the template was drawn. The 53 columns under them
move on every sync, so a few months later the strip read "Jul" over September's work.

The month row is now a render target like everything else:

```html
<div class="heat__months" data-gh="months" aria-hidden="true"></div>
```

The renderer writes one span per month, sized to that month's week columns and computed
from `contributions.range.to`.

**Upgrading from an earlier copy:** add `data-gh="months"` to your existing month row.
Until you do, the renderer exits with `FATAL: … .heat__months has no [data-gh="months"]
hook` instead of publishing labels that never move. Also replace the two
`.heat__months span:nth-child(odd|even)` width rules with the new `--w` rules in
`assets/section.css`, desktop and mobile.

---

## The heatmap is an empty strip, and nothing errored

A week column lost its explicit `grid-template-columns`. Without it the implicit column
resolves to `0`, all 371 squares render at zero width, and you get a clean empty band with
no error anywhere — the page looks *designed*, just empty.

This is the single most common way the section breaks, usually after someone "tidies up"
what looks like redundant CSS.

Count them:

```bash
grep -o 'grid-template-columns' index.html | wc -l    # expect 53 per rendered viewport
grep -o '<i ' index.html | wc -l                      # expect 371 per viewport, + 5 legend
```

---

## Streak reads 0 while I have obviously been committing

The streak is being computed over a range that includes **today**, the in-progress UTC day,
which is `0` for most of it.

Fixed in this package — `flatten()` excludes any day `>= todayUTC`. If you forked an older
copy, that is the bug. Note that no scheduled run time avoids it: any hour on 08-02 UTC
still sees 08-02 as incomplete, so it has to be excluded in code.

---

## It works in the terminal, does nothing under the scheduler

Three causes, in order of likelihood:

1. **`node` is not on the PATH.** launchd, cron and Task Scheduler run with a near-empty
   environment and do not source your shell profile. Use `bash -lc` (launchd), set `PATH=`
   explicitly (cron), or call node by absolute path.
2. **macOS Keychain.** Not readable from a non-interactive launchd session — error
   `-25308`. Use a `.env` file. See `API-SETUP.md §3`.
3. **Git auth.** The push prompts for a password no one is there to type, and hangs or
   fails. Use `GIT_ASKPASS` or a deploy key.

Read the log first — all three announce themselves clearly there, and none of them are
visible from the page.

---

## `FATAL: targets not found`

The renderer could not find a `[data-gh]` container it expected. Exiting non-zero here is
deliberate: the earlier behaviour was to skip quietly and exit 0, which let a page ship
with the heatmap and every repo card missing while the counters still updated — so it
looked alive.

Check the containers survived your edit:

```bash
grep -o 'data-gh="[^"]*"' index.html | sort | uniq -c
```

You need `heatmap` and `pinned` for each viewport you use, plus the scalars.

---

## The repo split bar disagrees with its own numbers

Someone hand-edited a `width:` percentage. Both bar widths are **derived** from the counts
at render time (`public / (public + private)`). Never author them.

---

## Pinned cards are missing but everything else worked

The account has no pinned items, or fewer than six. GitHub returns only what is pinned;
the renderer emits what it gets. Pin them at <https://github.com/your-login> → *Customize
your pins*.

---

## Private repo count is 0 but I have private repos

The token lacks repository access. A fine-grained token needs *All repositories* +
**Metadata: Read-only**; a classic token needs `repo`.

The fetch preserves a previously-known `privateRepos` value when the token cannot see it,
rather than overwriting it with `0` — so if the number looks stale rather than wrong, that
is why.

---

## Everything is stale and there is no error

That is fail-closed working as intended. A bad token or a bad response restores the
last-good data, leaves the page byte-identical and **skips the publish**. A half-updated
section is worse than a stale one because it looks fine.

Check the exit code and the log:

```bash
./scripts/sync.sh --dry-run; echo "exit=$?"
```

Do not publish by hand to "get it out". Fix the cause and re-run.

---

## The page updated but visitors still see the old one

A CDN or browser cache. If your host sets a long `max-age` on HTML, or your zone has a
minimum browser-cache TTL that *raises* a shorter one, the page you are testing is not the
page they are getting.

Verify against the deployed bytes with a cache-buster:

```bash
curl -s "https://your.site/?cb=$RANDOM" | grep -o 'data-gh="total"[^>]*>[^<]*'
```

If your stylesheet is cached, reference it as `style.css?v=N` and bump `N` when it
changes. A CDN purge is the other answer.

---

## A CSS change did not take effect

Check the **computed** value, not the rule you think won.

- Two rules of equal specificity are decided by **file order** — later wins.
- **A media query adds no specificity.** A descendant selector written outside one
  (`.wrap .thing`, 0-2-0) beats a plain class inside one (`.thing`, 0-1-0) at *every*
  width, including mobile.

That second one is responsible for more "my mobile styles are being ignored" reports than
anything else.
