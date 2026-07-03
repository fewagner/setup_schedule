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
- 🔄 Auto-refreshes every few minutes and whenever you return to the tab

## One-time setup (repo owner)

1. **Merge this to `main`** (the app reads/writes booking data on `main`).
2. **Enable GitHub Pages:** repo → *Settings → Pages → Build and deployment →
   Source: GitHub Actions*. The included workflow
   (`.github/workflows/pages.yml`) deploys the page on every push to `main`
   (booking commits under `data/` are excluded, no redeploy needed for them).
3. If the repository is **private**, note that GitHub Pages for private repos
   requires a paid plan, and everyone will need a token even to *view*
   bookings. A **public** repo works on the free plan and can be viewed
   without any token.

## One-time setup (every user, takes ~2 minutes)

Viewing the calendar needs nothing (public repo). To **create or delete
bookings**, the page commits to this repo on your behalf, so it needs a
GitHub token:

1. You need a GitHub account with **write access to this repository**
   (repo owner: *Settings → Collaborators → Add people*).
2. Create a fine-grained personal access token:
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** *Only select repositories* → this repo
   - **Permissions:** *Contents → Read and write* (nothing else)
   - Expiration: up to you (you can set up to a year)
3. Open the booking page, tap **⚙ Settings**, paste the token, **Save**.

The token is stored only in `localStorage` of your own browser — it never
leaves your device except to talk to `api.github.com`.

## Configuration

Edit the `CONFIG` block at the top of [`app.js`](app.js):

```js
const CONFIG = {
  owner: 'fewagner',
  repo: 'setup_schedule',
  branch: 'main',                          // branch holding the data
  dataPath: 'data/bookings.json',
  setups: ['Setup A', 'Setup B', 'Setup C'],  // ← your setups
  autoRefreshMinutes: 5,
};
```

## How it works

- The page fetches `data/bookings.json` through the GitHub Contents API.
- Saving a booking re-fetches the file, appends the new entry, and commits it
  back (`PUT /repos/.../contents/...`) with the file's `sha` for optimistic
  locking. If two people save at the same moment, the loser gets a `409` and
  automatically retries on top of the fresh version — no booking is lost.
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
