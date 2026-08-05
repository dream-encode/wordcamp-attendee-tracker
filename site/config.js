/*
 * Site configuration. This is the only file you need to edit by hand.
 *
 * The event list is NOT here -- it comes from data/events.json, which the poller writes
 * from config/events.json, so there is one source of truth for what is being tracked.
 */

export const CONFIG = {
	/*
	 * Deployed Cloudflare Worker URL, e.g.
	 * "https://wordcamp-attendee-tracker-state.your-subdomain.workers.dev"
	 *
	 * Leave empty and the site falls back to localStorage: everything still works, but the
	 * "last checked" marker is per-browser instead of shared across your devices.
	 */
	workerUrl: "https://wordcamp-attendee-tracker-state.david-27e.workers.dev",

	/*
	 * Used only to show when the poller last ran, so a quiet tracker is visibly alive
	 * rather than looking stale. Read from the public GitHub API with no token, which is
	 * why it needs no setup -- and why it degrades silently if the repo goes private or
	 * the unauthenticated rate limit (60/hour per IP) is hit. Set repo to "" to disable.
	 */
	githubRepo: "dream-encode/wordcamp-attendee-tracker",
	pollWorkflow: "poll-attendees.yml",

	/* Flag the poller as stalled if the last successful run is older than this. */
	staleAfterMinutes: 90
}
