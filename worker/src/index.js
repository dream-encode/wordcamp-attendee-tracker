/*
 * Last-checked marker for the attendee tracker.
 *
 * GitHub Pages is static, so the site cannot store the "when did I last look at this"
 * timestamp itself, and putting a repo-write token in client-side JS to make it commit
 * one is not an option. This Worker exists purely to hold that single value per event.
 *
 * It stores one string per event and nothing else. There is no auth: the marker is not
 * sensitive, and the blast radius of someone writing to it is that your unread count is
 * wrong until you press the button again.
 *
 *   GET  /v1/last-checked?event=<slug>   -> { event, last_checked_at }
 *   POST /v1/last-checked                -> { event, at } -> { event, last_checked_at }
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const KEY_PREFIX = "last-checked:"

/**
 * Resolves the CORS headers for a request.
 *
 * The origin is echoed only when it is on the configured allowlist, so a stray page cannot
 * read or clobber the marker from someone else's site.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Request} request Incoming request.
 * @param  {object}  env     Worker environment.
 * @return {object}          Headers to merge into the response.
 */
const corsHeaders = ( request, env ) => {
	const origin = request.headers.get( "origin" ) || ""
	const allowed = ( env.ALLOWED_ORIGINS || "" ).split( "," ).map( ( value ) => value.trim() ).filter( Boolean )

	const isAllowed = allowed.includes( origin )
		|| /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test( origin )

	if ( ! isAllowed ) {
		return {}
	}

	return {
		"access-control-allow-origin": origin,
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type",
		"access-control-max-age": "86400",
		vary: "Origin"
	}
}

/**
 * Builds a JSON response.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} body    Response body.
 * @param  {number} status  HTTP status.
 * @param  {object} headers Extra headers.
 * @return {Response}       JSON response.
 */
const json = ( body, status, headers ) => {
	return new Response( JSON.stringify( body ), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...headers
		}
	} )
}

/**
 * Validates an event slug.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} slug Candidate slug.
 * @return {boolean}     True when usable as a KV key segment.
 */
const isValidSlug = ( slug ) => {
	return "string" === typeof slug && SLUG_PATTERN.test( slug )
}

/**
 * Validates a client-supplied timestamp.
 *
 * The client sends the `updated_at` of the data snapshot it actually rendered, rather than
 * its own wall clock. That is the honest reading of "I have seen everything up to here" --
 * using the moment of the click instead would silently mark anyone who arrived between
 * page load and the button press as already seen.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} value Candidate ISO8601 timestamp.
 * @return {boolean}      True when parseable and not implausibly in the future.
 */
const isValidTimestamp = ( value ) => {
	if ( "string" !== typeof value ) {
		return false
	}

	const parsed = Date.parse( value )

	if ( Number.isNaN( parsed ) ) {
		return false
	}

	// One day of slack absorbs clock skew without accepting a marker from next year.
	return parsed <= Date.now() + 86_400_000
}

/**
 * Triggers the GitHub poll workflow.
 *
 * This Worker owns the poll schedule because GitHub's does not keep time. Scheduled
 * workflows are best-effort and throttled on free/public repos -- measured on this repo, a
 * "7,37" cron dropped three consecutive slots and went 93 minutes without firing, which
 * makes `added_at` far less precise than the cron implies. Cloudflare cron triggers fire on
 * time, and a *dispatched* GitHub run starts promptly, so routing the schedule through here
 * sidesteps the unreliable part while leaving the workflow itself untouched.
 *
 * Holding this in the same Worker as the marker API is a deliberate trade: the two
 * responsibilities are unrelated, but a second Worker would mean a second deploy and a
 * second config for one scheduled fetch.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} env Worker environment.
 * @return {Promise<void>}
 */
const dispatchPoll = async ( env ) => {
	if ( ! env.GITHUB_DISPATCH_TOKEN ) {
		throw new Error( "Cron fired but GITHUB_DISPATCH_TOKEN is not set. Run: npx wrangler secret put GITHUB_DISPATCH_TOKEN" )
	}

	const repo = env.GITHUB_REPO
	const workflow = env.GITHUB_WORKFLOW
	const ref = env.GITHUB_REF || "main"

	const response = await fetch( `https://api.github.com/repos/${ repo }/actions/workflows/${ workflow }/dispatches`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${ env.GITHUB_DISPATCH_TOKEN }`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			"content-type": "application/json",
			// GitHub rejects API requests without a User-Agent.
			"user-agent": "wordcamp-attendee-tracker-cron"
		},
		body: JSON.stringify( { ref } )
	} )

	// A successful dispatch is 204 No Content.
	if ( 204 !== response.status ) {
		throw new Error( `Workflow dispatch failed: HTTP ${ response.status } -- ${ await response.text() }` )
	}

	console.log( `Dispatched ${ workflow } on ${ ref } of ${ repo }.` )
}

export default {
	/**
	 * Cron entrypoint. Errors are surfaced so a failing dispatch shows in `wrangler tail`
	 * and the Workers dashboard rather than silently doing nothing every 30 minutes.
	 *
	 * @since  [NEXT_VERSION]
	 *
	 * @param  {object} event      Scheduled event.
	 * @param  {object} env        Worker environment.
	 * @param  {object} context    Execution context.
	 * @return {Promise<void>}
	 */
	async scheduled( event, env, context ) {
		context.waitUntil( dispatchPoll( env ) )
	},

	async fetch( request, env ) {
		const cors = corsHeaders( request, env )
		const url = new URL( request.url )

		if ( "OPTIONS" === request.method ) {
			return new Response( null, { status: 204, headers: cors } )
		}

		if ( "/v1/last-checked" !== url.pathname ) {
			return json( { error: "Not found." }, 404, cors )
		}

		if ( "GET" === request.method ) {
			const slug = url.searchParams.get( "event" )

			if ( ! isValidSlug( slug ) ) {
				return json( { error: "Missing or invalid event slug." }, 400, cors )
			}

			const stored = await env.TRACKER_STATE.get( `${ KEY_PREFIX }${ slug }` )

			return json( { event: slug, last_checked_at: stored }, 200, cors )
		}

		if ( "POST" === request.method ) {
			let body

			try {
				body = await request.json()
			} catch {
				return json( { error: "Body must be JSON." }, 400, cors )
			}

			if ( ! isValidSlug( body?.event ) ) {
				return json( { error: "Missing or invalid event slug." }, 400, cors )
			}

			if ( ! isValidTimestamp( body?.at ) ) {
				return json( { error: "Missing or invalid timestamp." }, 400, cors )
			}

			const at = new Date( body.at ).toISOString()

			await env.TRACKER_STATE.put( `${ KEY_PREFIX }${ body.event }`, at )

			return json( { event: body.event, last_checked_at: at }, 200, cors )
		}

		return json( { error: "Method not allowed." }, 405, { ...cors, allow: "GET, POST, OPTIONS" } )
	}
}
