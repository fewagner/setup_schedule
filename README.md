# 📅 Setup Schedule — measurement time booking

A tiny, serverless booking calendar for sharing measurement setups between a
small group of people. It is a single static web page (deployed via GitHub
Pages) and the bookings themselves are stored **in this repository** as
[`data/bookings.json`](data/bookings.json) — every booking is a git commit, so
you get a full history for free.

**Live page:** https://fewagner.github.io/setup_schedule/

## Features

- 📆 Week / 3-day / day / month calendar views (mobile friendly)
- 👆 Click (or press-and-drag on the phone) into the calendar to book a slot
- 🔴 A red line marks the current time; past bookings are shown faded
- 🧾 Each booking stores: **name, setup, start, end, optional note**, and an
  automatically added **creation timestamp**
- 🤝 Overlapping bookings are allowed — nothing blocks, people sort it out
- 🗑 Bookings can be deleted from their detail view
- 🔧 The setup list is editable on the page (⚙ Settings) and shared by everyone
- 🔄 Auto-refreshes every few minutes and whenever you return to the tab

## Usage rules

Shown on the page (ℹ button, and automatically on first visit):

1. Book only slots that you really intend to use.
2. If you realize you are not going to use a slot, delete the booking again.
3. There is no limit on booking time — try to split the time on shared
   setups fairly, to the best of your knowledge and abilities.
4. Help others and yourself to get the best science results.
5. The best setup is a setup that is used — don't be too cautious in
   booking time if you see there are slots available.

### Computers ↔ setups

| Computer | Setups |
| --- | --- |
| `qcpsi008` | Quasiparticles |
| `qcpsi010` | Resonators |
| `qcpsi016` | Microwave Detector, Heater (blocking Crosstalk) |
| `qcpsi018` | DMS, remote server 1 |
| `qcpsi021` | Crosstalk, remote server 2 |

## One-time setup (repo owner)

1. Make `main` the **default branch**: *Settings → General → Default branch*.
2. **Merge this to `main`** (the app reads/writes booking data on `main`).
3. **Enable GitHub Pages:** *Settings → Pages → Build and deployment →
   Source: Deploy from a branch → Branch: `main` / `/ (root)`*.
   The `.nojekyll` file makes this a plain static deploy (no Jekyll build).
   If the very first deployment fails with a generic *"Deployment failed,
   try again later"*, that is usually transient: re-run it from the
   *Actions* tab, or set the Pages source to *None*, save, and re-enable it.
4. Keep the repository **public** — Pages on private repos needs a paid
   plan, and a public repo lets everyone view the calendar without a token.

## Giving people booking access

To **create or delete bookings**, the page commits to this repo, so it needs
a GitHub token. The token is only ever kept in the browser's `localStorage`
and only talks to `api.github.com`.

**Recommended — one shared token (nobody else needs a GitHub account):**

1. The repo owner creates a fine-grained personal access token:
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** *Only select repositories* → this repo
   - **Permissions:** *Contents → Read and write* (nothing else)
2. Open the booking page, tap **⚙ Settings**, paste the token, **Save**,
   then tap **Copy share link** and send that link to the group via
   **private** chat/email. Opening the link once sets the token up
   automatically on their phone (it's scrubbed from the URL right away).

⚠️ **Never post the token (or the share link) anywhere public** — not in
this repo, not on a website. Two things go wrong: (1) anyone in the world
could edit this repository's contents, and (2) GitHub's secret scanning
detects leaked tokens in public places and **revokes them automatically
within minutes**, so a "public token" simply won't keep working. A link
shared in a private group chat is fine for a trust-based lab tool — if it
ever leaks, revoke the token on GitHub and share a fresh one.

**Alternative — everyone uses their own token:** each person needs write
access to the repo (*Settings → Collaborators*) and creates their own token
as above. Bookings are then committed under each person's own GitHub
account, which gives a nicer audit trail in the git history.

## Configuration

**Setups** (the dropdown choices) are managed directly on the page:
⚙ Settings → *Setups* → add or remove entries. The list is stored in
[`data/setups.json`](data/setups.json) and shared by everyone. Removing a
setup never touches existing bookings — it only disappears from the
dropdown for future bookings.

Everything else lives in the `CONFIG` block at the top of [`app.js`](app.js):

```js
const CONFIG = {
  owner: 'fewagner',
  repo: 'setup_schedule',
  branch: 'main',                  // branch holding the data
  dataPath: 'data/bookings.json',
  setupsPath: 'data/setups.json',
  defaultSetups: ['Setup A', 'Setup B', 'Setup C'],  // fallback only
  autoRefreshMinutes: 5,
};
```

## How it works

- The page fetches `data/bookings.json` through the GitHub Contents API.
  All reads use `cache: 'no-store'` — the GitHub API marks responses as
  cacheable for 60 s, and a browser-cached copy would mean stale calendars
  and stale `sha`s (spurious write conflicts).
- Saving is pull-then-push: the file is re-fetched fresh from GitHub, the
  change is applied on top of that latest version, and the result is
  committed back (`PUT /repos/.../contents/...`) with the file's `sha` for
  optimistic locking. If someone else's commit lands in between, GitHub
  answers `409`, and the app waits a randomized moment and redoes the whole
  pull+push (up to 6 attempts) — no booking is lost, even when several
  people save at once.
- The page itself (HTML/JS) is served by GitHub Pages with a ~10 minute
  CDN cache — that only delays app updates, never booking data.
- Booking format:

  ```json
  {
    "id": "0b0e6e0e-…",
    "name": "Ada",
    "setup": "Setup A",
    "start": "2026-07-04T08:00:00.000Z",
    "end": "2026-07-04T12:00:00.000Z",
    "note": "calibration run",
    "createdAt": "2026-07-03T09:12:41.003Z"
  }
  ```

  Times are stored in UTC and displayed in each viewer's local timezone.

- No server, no database, no build step, no CDN — the calendar UI is
  [FullCalendar](https://fullcalendar.io), vendored in `vendor/` so the page
  is fully self-contained. The only moving parts are GitHub Pages (hosting)
  and the GitHub API (storage).

## Caveats

- Unauthenticated reads of the GitHub API are rate-limited to 60/hour per IP
  — plenty for a group of three, but add your token if you ever hit it.
- Deleting is not restricted per person — anyone in the group can delete any
  booking (it's a trust-based tool; the git history keeps everyone honest).
- With the shared-token setup, all booking commits are authored by the token
  owner's account; the person who booked is still recorded in the booking's
  `name` field.
