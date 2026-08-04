# Changelog

## [NEXT_VERSION] - [UNRELEASED]

* FEA: Tracker - record `added_at` for every attendee the first time they appear on a WordCamp attendee list, and surface who arrived since the list was last marked as checked.
* FEA: Site - static GitHub Pages front end leading with the new count and the total, with newest-first arrivals, departures, a searchable roster and a growth timeline.
* FEA: Worker - Cloudflare Worker backed by KV holding the shared "last checked" marker, so the unread count follows you across devices.
* FEA: Notifications - SMTP email summarising arrivals and departures, skipped cleanly when SMTP is not configured.
* FEA: Config - multi-event support driven by `config/events.json`, published to the site as `data/events.json`.
* ENH: Parser - decode the percent-encoded company label CampTix emits for values that are not real URLs.
* ENH: Merge - collapse duplicate ticket registrations into one person while keeping two people who share a single email separate.
* ENH: Poll - roster-drop guard aborts a run that returns under 80% of the previous roster, protecting recorded `added_at` values from a truncated response.
* ENH: Poll - write data files only when the meaningful content changes, so an unchanged poll produces no commit.
* TSK: Tests - cover parsing, deduplication, arrival and departure stamping, and the drop guard.
