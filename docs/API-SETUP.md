# GitHub API setup

Everything this package reads comes from **one authenticated GraphQL call**. The
contribution calendar and pinned items have no REST equivalent, and both require a token
even for entirely public data. There is no unauthenticated path.

---

## 1. Get a token

### Option A — the `gh` CLI

```bash
gh auth status     # already logged in?
gh auth login      # if not
gh auth token      # prints a token you can use immediately
```

Fine on a laptop. Less good on a server: it rotates when you re-authenticate, and the job
starts failing silently at whatever hour it runs.

### Option B — a fine-grained personal access token

<https://github.com/settings/personal-access-tokens/new>

| Field | Value |
|---|---|
| Repository access | *Public repositories* — enough for public counts.<br>*All repositories* — needed if you want **private** repos counted. |
| Repository permissions | **Metadata: Read-only**. That is all. Not code, not contents. |
| Account permissions | Nothing extra. |
| Expiry | Up to a year. **Write the date down.** |

An expired token is the most common cause of "it just stopped updating". The failure is
quiet by design — the section keeps showing the last-good data rather than breaking.

### Classic tokens

Work too. `read:user` plus `repo` if you want private counts. Fine-grained is preferred
because `repo` on a classic token grants full read/write to every repository you can see,
which is far more than this needs.

---

## 2. Turn on private contributions

**This one silently changes the headline number, so do it before you judge the output.**

<https://github.com/settings/profile> → **Contributions** → tick
*"Include private contributions on my profile"*.

With it off, the contribution calendar returns public activity only. In one real case the
12-month total read **69** instead of **350**.

The tell in the fetched data is:

```json
"restrictedContributionsCount": 0
```

That field counts private contributions that **are** included but redacted. `0` therefore
means *excluded entirely* — not "you have none". If you see `0` and you know you have
private commits, the setting is off.

There is no API for this. Only the account owner can change it, in the web UI.

---

## 3. Store the credentials

### On a workstation

Environment variables, or a `.env` beside `sync.sh`:

```bash
GITHUB_USER=your-login
GITHUB_TOKEN=github_pat_...
TARGETS=/path/to/site/index.html
```

```bash
chmod 600 .env
```

`.env` is in `.gitignore`. Keep it that way.

### On a macOS server — read this before using the Keychain

**The login Keychain does not work under `launchd`.** A non-interactive session gets:

```
User interaction is not allowed   (error -25308)
```

It works when you test it in Terminal, because that session is interactive and unlocked.
It then fails at 00:00 with no one watching. Use the `.env` file on servers.

### On Linux

`EnvironmentFile=` in the systemd unit, pointing at the same `.env`. Or systemd
credentials if you want them encrypted at rest.

### On GitHub Actions

A repository secret. Name it something other than `GITHUB_TOKEN` — that name is reserved
and the automatic one **will not work here**: it is scoped to the repository and cannot
read your user contribution calendar or your pinned items. The workflow template uses
`GH_READ_TOKEN`.

---

## 4. Git authentication for the publish step

If the scheduled job pushes to a repository, it needs to authenticate with no human
present. Do **not** put a token in the remote URL or in `.git/config` — it ends up in
every clone and in `git remote -v`.

Use an askpass helper that reads the same `.env`:

```bash
#!/usr/bin/env bash
# git-askpass.sh — chmod 700
set -a; . "$(dirname "$0")/.env"; set +a
case "$1" in
  *Username*) echo "$GITHUB_USER" ;;
  *Password*) echo "$GITHUB_TOKEN" ;;
esac
```

```bash
GIT_ASKPASS=/path/to/git-askpass.sh git push
```

A deploy key is the other good answer, and is better if the server only ever touches one
repository.

---

## 5. Verify

```bash
GITHUB_USER=your-login GITHUB_TOKEN=your-token node scripts/fetch-github.mjs
node scripts/validate.mjs
```

A good run prints something like:

```
OK  your-login  350 contributions  streak 8d (best 8d)  6 pinned  3 pushes
OK  53x7 matrix, 350 contributions, 6 pinned repos, 0h old
```

Check the total against <https://github.com/your-login> before you schedule anything.
