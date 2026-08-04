# WordCamp Attendee Tracker

A WordCamp attendee page tells you **who** is attending. It does not tell you **when**
anyone was added, and that data does not exist anywhere until something starts recording
it. This records it, then shows you who turned up since the last time you looked.

```
  14 new since you last checked  ·  647 attendees total
```

## How it works

1. A scheduled GitHub Action fetches each configured attendee page every 30 minutes.
2. It parses the roster, diffs it against the stored snapshot, and stamps `added_at` on
   anyone it has not seen before (and `departed_at` on anyone who vanished).
3. It commits the result to `site/data/` only when something actually changed, then emails
   you if there were arrivals or departures.
4. GitHub Pages serves the static site, which reads that JSON and leads with the two
   numbers that matter: how many are new, and how many there are in total.
5. A small Cloudflare Worker holds the one piece of mutable state — the "last checked"
   timestamp — so it is shared across your devices rather than trapped in one browser.

### Why it scrapes

There is no attendee API. `/wp-json/wp/v2/tix_attendee` returns 404 and the REST index
registers only `speakers` and `sessions` — CampTix never exposes attendees. Every
assumption about the page structure is isolated in
[fetch-attendees.js](scripts/lib/fetch-attendees.js), so that is the only file that needs
to change if WordCamp alters the markup.

## Setup

### 1. Repository

Push this to GitHub, then under **Settings → Pages → Build and deployment** set
**Source** to **GitHub Actions**. The poller needs `contents: write`, which
[poll-attendees.yml](.github/workflows/poll-attendees.yml) already requests.

### 2. Cloudflare Worker (shared "last checked" marker)

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create TRACKER_STATE   # paste the id into wrangler.toml
npx wrangler deploy
```

Then set two things:

- `ALLOWED_ORIGINS` in [wrangler.toml](worker/wrangler.toml) → your Pages origin.
- `workerUrl` in [site/config.js](site/config.js) → the deployed Worker URL.

Skipping this step is fine. The site falls back to `localStorage`, so everything still
works — the marker is just per-browser instead of shared, and the page says so.

### 3. Email notifications

Add these repository secrets. Leave them out and the poll still runs, it just does not
send mail.

| Secret | Example |
|---|---|
| `SMTP_HOST` | `smtp.example.com` |
| `SMTP_PORT` | `587` (`465` switches to implicit TLS) |
| `SMTP_USER` | `tracker@example.com` |
| `SMTP_PASS` | — |
| `SMTP_FROM` | `WordCamp Tracker <tracker@example.com>` |
| `SMTP_TO` | `you@example.com` |

Optionally set the `SITE_URL` repository **variable** to add a link to the tracker in the
email body.

### 4. First run

```bash
npm ci
npm run poll
```

The first run is a baseline import: everyone currently listed is recorded with
`baseline: true` and excluded from "new", because they were added before tracking existed
and have no real date. Everyone after that gets a genuine `added_at`.

## Tracking more events

Add an entry to [config/events.json](config/events.json):

```json
{
	"slug": "wceu-2027",
	"name": "WordCamp Europe 2027",
	"location": "Basel, CH",
	"url": "https://europe.wordcamp.org/2027/attendees/",
	"active": true
}
```

The poller writes `site/data/events.json` from this file, so the site picks the new event
up automatically and shows a switcher. Set `"active": false` to stop polling an event
without deleting its history.

## Commands

| Command | What it does |
|---|---|
| `npm run poll` | Poll every active event and write changes |
| `npm run poll:dry` | Report what would change; write and send nothing |
| `node scripts/poll.js --event=wcus-2026` | Poll one event |
| `node scripts/poll.js --fixture=page.html` | Parse a local file instead of fetching |
| `node scripts/poll.js --force` | Bypass the roster-drop guard |
| `npm test` | Run the test suite |
| `npm run lint` | Lint |

To work on the site locally, serve it over HTTP — `fetch` cannot read the JSON over
`file://`:

```bash
npx serve site
```

## Things worth knowing

**`added_at` is when the tracker first saw someone**, not when they registered. No
registration date is published anywhere, so this is the closest thing that can exist. Its
precision is the poll interval: at `*/30` it is accurate to within half an hour.

**The roster-drop guard will fail a run rather than trust a bad response.** If a poll
returns under 80% of the previous roster, it aborts without writing. A truncated or
rate-limited response is indistinguishable from a genuine mass departure, and acting on
one would stamp `departed_at` across everyone — then, when the next good poll brought them
back, they would all look like new arrivals and every `added_at` would be overwritten with
the wrong date. That is the one unrecoverable failure here. If a large drop is real, re-run
with `--force`.

**Duplicate registrations are collapsed.** People buy multiple tickets under one email, so
the source page lists more rows than there are humans — WCUS 2026 shows 634 rows for 628
people. The site counts people; the row count is kept alongside it. Conversely, two people
sharing one email are kept separate, which is why identity is keyed on the Gravatar hash
*and* the name rather than the hash alone.

**Scheduled workflows are disabled after 60 days of repository inactivity.** The poller's
own commits normally keep it alive, but if arrivals go quiet for a long stretch, check that
the workflow is still enabled.
