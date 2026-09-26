# Health Monitor

A tiny personal activity tracker: each activity has a max duration, a
countdown, and a reset button. Hosted entirely on GitHub Pages, data stored
as JSON in the repo, expiry checks and email alerts run by GitHub Actions.

No backend, no database, no build step.

## Files

```
index.html              # page shell
style.css               # styling
app.js                  # renders timers, handles reset/add, writes to GitHub
data/activities.json    # the actual data — this is your "database"
scripts/check-expired.js
.github/workflows/check-expired.yml
```

## Setup

1. Create a new GitHub repo and push these files to it.
2. In **Settings → Pages**, set the source to your default branch (`main`),
   root folder. Your site will be at
   `https://<username>.github.io/<repo>/`.
3. Open `app.js` and edit the three lines at the top:
   ```js
   owner: "YOUR_GITHUB_USERNAME",
   repo: "YOUR_REPO_NAME",
   branch: "main",
   ```
4. In **Settings → Secrets and variables → Actions**, add these repo secrets
   so the email step can send mail via SMTP:
   - `MAIL_SERVER` (e.g. `smtp.gmail.com`)
   - `MAIL_PORT` (e.g. `465`)
   - `MAIL_USERNAME`
   - `MAIL_PASSWORD` (for Gmail, use an [app password](https://myaccount.google.com/apppasswords), not your real password)
   - `MAIL_TO` (your own email address)
5. Edit `data/activities.json` to whatever activities you want to start with.
6. Visit your Pages URL. The first time you click **Reset** or **+**, it
   will ask for a GitHub token (see below).

## How the countdown works

Nothing runs a live JS counter. Every activity stores a `resetAt` timestamp
and a `maxDurationMinutes`. On every render (and every 30s while the tab is
open), the app computes:

```
remaining = maxDurationMinutes - (now - resetAt)
```

So the slider/remaining-time display is always correct from real elapsed
time, whether you closed the tab for five minutes or five days.

## How the GitHub Actions side works

Every 15 minutes, a workflow:
1. Reads `data/activities.json`.
2. For any activity where `now >= resetAt + maxDuration` and it hasn't been
   notified yet, marks it `notified: true` and adds it to the email.
3. If anything newly expired, sends you an email (via SMTP, using the
   secrets above) and commits the updated JSON back to the repo, using the
   automatic `GITHUB_TOKEN` that Actions provides for every run — no manual
   token needed for this part, since it's server-side.

## Authentication: why the website needs a token, and how to do it safely

This is the one tricky part of a "no backend" app, so here's the reasoning:

**Reading** the activity data is free — `app.js` just does a normal
`fetch('./data/activities.json')`, the same as loading any other file your
Pages site serves. No auth needed.

**Writing** is different. Clicking Reset or + needs to change a file that
lives in your GitHub repo, and GitHub Pages has no server component that
could do that for you — every request comes straight from your browser.
The only way to modify a file in a repo from a browser is to call GitHub's
REST API (`PUT /repos/{owner}/{repo}/contents/{path}`), and that endpoint
requires an authenticated request with write access to the repo.

So there's no way to avoid a token being present in the browser for the
write path. Given that constraint, the approach here is:

- Use a **fine-grained personal access token** (Settings → Developer
  settings → Personal access tokens → Fine-grained tokens), scoped to:
  - **Only this one repository** (not "all repos")
  - Permission: **Contents: Read and write**, nothing else
  - A short expiration (e.g. 90 days), so an old leaked token stops working
- The app asks for this token once via a `prompt()` and stores it in
  `localStorage`. It is **never** committed to the repo, never sent
  anywhere except `api.github.com` over HTTPS, and never leaves that one
  browser.
- Because it's sitting in that browser's storage, treat it like a
  password: only do this on a personal device, not a shared/public
  computer. If you ever suspect it leaked, revoke it from GitHub settings
  — since it's scoped to just this repo with read/write on contents, the
  worst case is someone edits this one JSON file, not your other repos or
  account.

This is different from the token the **Actions workflow** uses to commit
the "notified" flag back after sending an email — that's the automatic
`GITHUB_TOKEN` GitHub itself injects into every workflow run. It's scoped
to that single run, expires when the run ends, and is never exposed to
the browser, which is why that part of the system needed zero setup from
you.

If you'd rather not put a token in the browser at all, the only real
alternative is adding a small serverless function (e.g. a Cloudflare
Worker or Vercel function) to hold the token server-side and proxy the
write — but that reintroduces a "backend," which the brief asked to avoid,
so it's left out here.

## Notes / limitations (kept intentionally simple)

- Single-user tool: no accounts, no multi-device sync beyond "everyone with
  the token can edit the same file."
- After a write, GitHub Pages may take up to a minute to reflect the new
  file if you reload immediately (GitHub's CDN caches static assets
  briefly). The in-memory state updates instantly regardless.
- Removing an activity just deletes it from the JSON array.
