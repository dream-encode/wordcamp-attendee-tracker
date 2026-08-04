#!/usr/bin/env node

/*
 * Poll entrypoint. Fetches each configured attendee list, stamps arrivals and departures
 * into site/data/<slug>/, and emails a summary when anything changed.
 *
 * Usage:
 *   node scripts/poll.js                        poll every active event
 *   node scripts/poll.js --event=wcus-2026      poll one event
 *   node scripts/poll.js --dry-run              report only, write nothing, send nothing
 *   node scripts/poll.js --fixture=path.html    parse a local file instead of fetching
 *   node scripts/poll.js --force                bypass the roster-drop guard
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { fetchAttendees, parseAttendees } from "./lib/fetch-attendees.js"
import { dedupeAttendees, mergeAttendees, countActive, assertRosterPlausible } from "./lib/merge.js"
import { sendSummaryEmail } from "./lib/notify.js"

const ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), ".." )
const DATA_DIR = join( ROOT, "site", "data" )
const CONFIG_PATH = join( ROOT, "config", "events.json" )

const { values: flags } = parseArgs( {
	options: {
		event: { type: "string" },
		fixture: { type: "string" },
		"dry-run": { type: "boolean", default: false },
		force: { type: "boolean", default: false }
	}
} )

const isDryRun = flags[ "dry-run" ]

/**
 * Reads a JSON file, returning a fallback when it does not exist yet.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} path     Absolute file path.
 * @param  {*}      fallback Value to return when the file is absent.
 * @return {Promise<*>}      Parsed JSON, or the fallback.
 */
const readJson = async ( path, fallback ) => {
	if ( ! existsSync( path ) ) {
		return fallback
	}

	return JSON.parse( await readFile( path, "utf8" ) )
}

/**
 * The parts of the attendee file that represent real information.
 *
 * Compared byte-for-byte to decide whether to write. Excludes updated_at, which would
 * otherwise differ on every run and cause a commit on every poll. This replaces a
 * membership-only check, which would have left genuine edits (people do change their job
 * title after registering) permanently stale in the published data.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} payload Attendee file payload.
 * @return {string}         Canonical projection for comparison.
 */
const meaningfulProjection = ( payload ) => {
	return JSON.stringify( {
		total: payload.total,
		rows: payload.rows,
		attendees: payload.attendees
	} )
}

/**
 * Decides whether runs.json should gain a point this poll.
 *
 * Recording every poll would add ~48 identical points a day and make the growth chart
 * mostly flat noise. A point is kept when the count moved, or once a day so the timeline
 * still shows continuity through quiet stretches.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} points Existing timeline points.
 * @param  {number}        total  Active attendee count this poll.
 * @param  {string}        now    ISO8601 timestamp for this run.
 * @return {boolean}              True when the point should be appended.
 */
const shouldRecordPoint = ( points, total, now ) => {
	const last = points[ points.length - 1 ]

	if ( ! last ) {
		return true
	}

	if ( last.total !== total ) {
		return true
	}

	return last.at.slice( 0, 10 ) !== now.slice( 0, 10 )
}

/**
 * Polls a single event and writes its data files.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} event Event config entry.
 * @return {Promise<object>} Summary of what changed.
 */
const pollEvent = async ( event ) => {
	const now = new Date().toISOString()
	const eventDir = join( DATA_DIR, event.slug )
	const attendeesPath = join( eventDir, "attendees.json" )
	const runsPath = join( eventDir, "runs.json" )

	const parsed = flags.fixture
		? parseAttendees( await readFile( resolve( flags.fixture ), "utf8" ) )
		: await fetchAttendees( event.url )

	const { people, rows } = dedupeAttendees( parsed )

	const storedFile = await readJson( attendeesPath, null )
	const stored = storedFile?.attendees ?? []
	const isBaseline = 0 === stored.length
	const previousActive = countActive( stored )

	assertRosterPlausible( people.length, previousActive, { force: flags.force, label: event.slug } )

	const { attendees, arrived, departed, returned, updated } = mergeAttendees( stored, people, now, isBaseline )
	const total = countActive( attendees )

	const payload = {
		event: event.slug,
		name: event.name,
		location: event.location ?? "",
		source_url: event.url,
		tracking_started_at: storedFile?.tracking_started_at ?? now,
		updated_at: now,
		total,
		rows,
		attendees
	}

	const changed = ! storedFile || meaningfulProjection( payload ) !== meaningfulProjection( storedFile )

	const runsFile = await readJson( runsPath, { event: event.slug, points: [] } )
	const recordPoint = changed && shouldRecordPoint( runsFile.points, total, now )

	const summary = {
		slug: event.slug,
		name: event.name,
		url: event.url,
		total,
		rows,
		baseline: isBaseline,
		changed,
		arrived,
		departed,
		returned,
		updated
	}

	if ( isDryRun || ! changed ) {
		return summary
	}

	await mkdir( eventDir, { recursive: true } )
	await writeFile( attendeesPath, `${ JSON.stringify( payload, null, "\t" ) }\n`, "utf8" )

	if ( recordPoint ) {
		runsFile.points.push( {
			at: now,
			total,
			rows,
			arrived: arrived.length,
			departed: departed.length
		} )

		await writeFile( runsPath, `${ JSON.stringify( runsFile, null, "\t" ) }\n`, "utf8" )
	}

	return summary
}

/**
 * Prints a human-readable summary for one event.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} summary Result from pollEvent().
 * @return {void}
 */
const report = ( summary ) => {
	const name = `${ summary.name } (${ summary.slug })`

	if ( summary.baseline ) {
		console.log( `${ name }: baseline import -- ${ summary.total } attendees recorded from ${ summary.rows } listed rows.` )
		console.log( "   These predate tracking, so they carry no real added_at and are excluded from \"new\"." )

		return
	}

	console.log( `${ name }: ${ summary.total } attendees (${ summary.rows } listed rows)` )
	console.log( `   arrived: ${ summary.arrived.length }  departed: ${ summary.departed.length }  returned: ${ summary.returned.length }  edited: ${ summary.updated.length }` )

	for ( const person of summary.arrived ) {
		console.log( `   + ${ person.first } ${ person.last }${ person.job_title ? ` -- ${ person.job_title }` : "" }` )
	}

	for ( const person of summary.departed ) {
		console.log( `   - ${ person.first } ${ person.last }` )
	}

	for ( const person of summary.updated ) {
		console.log( `   ~ ${ person.first } ${ person.last } (${ person.changes.join( ", " ) })` )
	}

	if ( ! summary.changed ) {
		console.log( "   no change" )
	}
}

/**
 * Publishes the event list for the site to read.
 *
 * Keeps config/events.json the single source of truth -- the site discovers what to render
 * from here rather than carrying its own copy of the list that could drift.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} events All configured events.
 * @return {Promise<void>}
 */
const writeManifest = async ( events ) => {
	const manifest = {
		events: events
			.filter( ( event ) => false !== event.active )
			.map( ( { slug, name, location, url } ) => ( { slug, name, location: location ?? "", url } ) )
	}

	const path = join( DATA_DIR, "events.json" )
	const existing = await readJson( path, null )

	if ( existing && JSON.stringify( existing ) === JSON.stringify( manifest ) ) {
		return
	}

	await mkdir( DATA_DIR, { recursive: true } )
	await writeFile( path, `${ JSON.stringify( manifest, null, "\t" ) }\n`, "utf8" )
}

const main = async () => {
	const events = JSON.parse( await readFile( CONFIG_PATH, "utf8" ) )
	const selected = events.filter( ( event ) => {
		if ( flags.event ) {
			return event.slug === flags.event
		}

		return false !== event.active
	} )

	if ( 0 === selected.length ) {
		throw new Error( flags.event ? `No event in config/events.json with slug "${ flags.event }".` : "No active events in config/events.json." )
	}

	if ( isDryRun ) {
		console.log( "DRY RUN -- nothing will be written or sent.\n" )
	} else {
		await writeManifest( events )
	}

	const summaries = []
	const failures = []

	for ( const event of selected ) {
		try {
			const summary = await pollEvent( event )

			summaries.push( summary )
			report( summary )
		} catch ( error ) {
			failures.push( { slug: event.slug, error } )
			console.error( `${ event.slug }: ${ error.message }` )
		}
	}

	const notable = summaries.filter( ( summary ) => ! summary.baseline && ( summary.arrived.length > 0 || summary.departed.length > 0 ) )

	if ( ! isDryRun && notable.length > 0 ) {
		await sendSummaryEmail( notable )
	}

	if ( failures.length > 0 ) {
		process.exitCode = 1
	}
}

await main()
