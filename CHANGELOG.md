# Changelog

## [NEXT_VERSION] - [UNRELEASED]
* FEA: Tracker - record `added_at` for every attendee the first time they appear on a WordCamp attendee list, and surface who arrived since the list was last marked as checked.
* FEA: Site - static Cloudflare Pages front end leading with the new count and the total, with newest-first arrivals, departures, a searchable roster and a growth timeline.
* FEA: Worker - Cloudflare Worker backed by KV holding the shared "last checked" marker, so the unread count follows you across devices.
* FEA: Notifications - SMTP email summarizing arrivals and departures, skipped cleanly when SMTP is not configured.
* FEA: Config - multi-event support driven by `config/events.json`, published to the site as `data/events.json`.
* ENH: Parser - decode the percent-encoded company label CampTix emits for values that are not real URLs.
* ENH: Merge - collapse duplicate ticket registrations into one person while keeping two people who share a single email separate.
* ENH: Poll - roster-drop guard aborts a run that returns under 80% of the previous roster, protecting recorded `added_at` values from a truncated response.
* ENH: Poll - write data files only when the meaningful content changes, so an unchanged poll produces no commit.
* BUG: Workflows - chain the Pages deploy onto the poll job. GitHub does not start workflow runs from pushes made with `GITHUB_TOKEN`, so the poller committed new attendee data that the site never published.
* BUG: Workflows - deploy the commit the poller just pushed rather than `github.sha`, which in a called workflow is the commit that started the run. The deploy was checking out the pre-poll tree and republishing stale data while reporting success.
* ENH: Workflows - log the commit and attendee totals being published, so a stale deploy is visible in the run log instead of silent.
* ENH: Site - show when the source was last polled, separately from when the data last changed, and flag the poller as stalled past 90 minutes. A roster sits unchanged overnight, so a single "updated" timestamp made a healthy tracker indistinguishable from a broken one.
* ENH: Site - relabel the headline meta so "checked" is not used for both your read marker and the poll, and say "last change" rather than "data updated".
* ENH: Worker - own the poll schedule via a Cloudflare cron trigger that dispatches the GitHub workflow. GitHub scheduled workflows are throttled to the point of dropping three consecutive slots and going 93 minutes without firing, which made `added_at` far less precise than the cron implied. The GitHub cron stays as a backstop.
* TSK: Tests - cover parsing, deduplication, arrival and departure stamping, and the drop guard.
* TWK: Lint - ignore the `.wrangler` build output, which otherwise reports hundreds of style errors in generated code after a Worker dev session.
