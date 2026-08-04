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
	workerUrl: ""
}
