import { CONFIG } from "./config.js"
import { renderGrowthChart } from "./growth-chart.js"

/*
 * Reads the JSON the poller commits and answers one question above all others: who was
 * added since the last time this list was marked as checked, and how many are there now.
 *
 * All attendee text is rendered through textContent rather than innerHTML -- names, job
 * titles and company strings are free text from a public registration form.
 */

const ROSTER_PAGE_SIZE = 60

const state = {
	event: null,
	data: null,
	runs: [],
	lastChecked: null,
	markerMode: "local",
	sort: "recent",
	query: "",
	visible: ROSTER_PAGE_SIZE
}

const el = ( id ) => document.getElementById( id )

/* ---------- Formatting ---------- */

const relativeTime = ( iso ) => {
	const formatter = new Intl.RelativeTimeFormat( undefined, { numeric: "auto" } )
	const diffMs = new Date( iso ).getTime() - Date.now()
	const units = [
		[ "year", 31_536_000_000 ],
		[ "month", 2_592_000_000 ],
		[ "week", 604_800_000 ],
		[ "day", 86_400_000 ],
		[ "hour", 3_600_000 ],
		[ "minute", 60_000 ]
	]

	for ( const [ unit, ms ] of units ) {
		if ( Math.abs( diffMs ) >= ms ) {
			return formatter.format( Math.round( diffMs / ms ), unit )
		}
	}

	return "just now"
}

const exactTime = ( iso ) => {
	return new Date( iso ).toLocaleString( undefined, {
		dateStyle: "medium",
		timeStyle: "short"
	} )
}

const shortTime = ( iso ) => {
	return new Date( iso ).toLocaleString( undefined, {
		dateStyle: "medium",
		timeStyle: "short"
	} )
}

const plural = ( count, singular, pluralForm ) => {
	return 1 === count ? singular : ( pluralForm ?? `${ singular }s` )
}

/**
 * Only linkify something that is actually a URL.
 *
 * The registration form does not validate this field -- one WCUS 2026 entry has a company
 * URL of "http://Automattic", which is a company name in a URL box. Rendering that as a
 * link produces a dead anchor, so anything without a dotted host stays plain text.
 */
const usableUrl = ( value ) => {
	if ( ! value ) {
		return null
	}

	try {
		const url = new URL( value )

		if ( "http:" !== url.protocol && "https:" !== url.protocol ) {
			return null
		}

		return url.hostname.includes( "." ) ? url.href : null
	} catch {
		return null
	}
}

const initials = ( person ) => {
	return `${ ( person.first || "" ).charAt( 0 ) }${ ( person.last || "" ).charAt( 0 ) }`.toUpperCase() || "?"
}

/* ---------- Last-checked marker ---------- */

const localKey = ( slug ) => `wcat:last-checked:${ slug }`

const readMarker = async ( slug ) => {
	if ( CONFIG.workerUrl ) {
		try {
			const response = await fetch( `${ CONFIG.workerUrl }/v1/last-checked?event=${ encodeURIComponent( slug ) }`, { cache: "no-store" } )

			if ( response.ok ) {
				state.markerMode = "shared"

				return ( await response.json() ).last_checked_at ?? null
			}
		} catch {
			/* Fall through to localStorage so the page still works when the Worker is down. */
		}
	}

	state.markerMode = "local"

	return localStorage.getItem( localKey( slug ) )
}

const writeMarker = async ( slug, at ) => {
	if ( CONFIG.workerUrl ) {
		try {
			const response = await fetch( `${ CONFIG.workerUrl }/v1/last-checked`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify( { event: slug, at } )
			} )

			if ( response.ok ) {
				state.markerMode = "shared"

				return true
			}
		} catch {
			/* Fall through. */
		}
	}

	state.markerMode = "local"
	localStorage.setItem( localKey( slug ), at )

	return true
}

/* ---------- Selectors over the loaded data ---------- */

const activeAttendees = () => {
	return state.data.attendees.filter( ( person ) => ! person.departed_at )
}

/**
 * Arrivals since the marker.
 *
 * Baseline records are excluded: they were already on the list when tracking started, so
 * they have no real added date and were never "new" to anyone.
 */
const newArrivals = () => {
	return activeAttendees()
		.filter( ( person ) => ! person.baseline )
		.filter( ( person ) => ! state.lastChecked || person.added_at > state.lastChecked )
		.sort( ( a, b ) => b.added_at.localeCompare( a.added_at ) )
}

const recentDepartures = () => {
	return state.data.attendees
		.filter( ( person ) => person.departed_at )
		.filter( ( person ) => ! state.lastChecked || person.departed_at > state.lastChecked )
		.sort( ( a, b ) => b.departed_at.localeCompare( a.departed_at ) )
}

const totalAtLastCheck = () => {
	if ( ! state.lastChecked || 0 === state.runs.length ) {
		return null
	}

	const earlier = state.runs.filter( ( point ) => point.at <= state.lastChecked )

	return earlier.length > 0 ? earlier[ earlier.length - 1 ].total : null
}

/* ---------- Rendering ---------- */

const personNode = ( person, mode ) => {
	const item = document.createElement( "li" )

	item.className = "person"

	const avatar = document.createElement( "div" )

	avatar.className = "person__avatar"
	avatar.textContent = initials( person )

	if ( person.gravatar_hash ) {
		const img = document.createElement( "img" )

		img.src = `https://secure.gravatar.com/avatar/${ person.gravatar_hash }?s=96&d=blank&r=g`
		img.alt = ""
		img.loading = "lazy"
		img.decoding = "async"
		avatar.append( img )
	}

	const body = document.createElement( "div" )

	body.className = "person__body"

	const name = document.createElement( "div" )

	name.className = "person__name"
	name.textContent = `${ person.first } ${ person.last }`.trim()

	if ( person.ticket_rows > 1 ) {
		const badge = document.createElement( "span" )

		badge.className = "person__badge"
		badge.textContent = `${ person.ticket_rows } tickets`
		badge.title = "Listed more than once on the source page, collapsed into one person."
		name.append( badge )
	}

	body.append( name )

	const metaParts = []

	if ( person.job_title ) {
		metaParts.push( person.job_title )
	}

	const meta = document.createElement( "div" )

	meta.className = "person__meta"
	meta.textContent = metaParts.join( "" )

	if ( person.company ) {
		const href = usableUrl( person.company_url )

		if ( metaParts.length > 0 ) {
			meta.append( document.createTextNode( " · " ) )
		}

		if ( href ) {
			const link = document.createElement( "a" )

			link.href = href
			link.textContent = person.company
			link.rel = "noopener noreferrer nofollow"
			link.target = "_blank"
			meta.append( link )
		} else {
			meta.append( document.createTextNode( person.company ) )
		}
	}

	if ( meta.textContent.trim() ) {
		body.append( meta )
	}

	const when = document.createElement( "div" )

	when.className = "person__when"

	if ( "departed" === mode ) {
		when.textContent = `Removed ${ relativeTime( person.departed_at ) }`
		when.title = exactTime( person.departed_at )
	} else if ( person.baseline ) {
		when.textContent = "Listed before tracking started"
	} else {
		when.textContent = `Added ${ relativeTime( person.added_at ) }`
		when.title = exactTime( person.added_at )
	}

	body.append( when )
	item.append( avatar, body )

	return item
}

const fillList = ( node, people, mode ) => {
	node.replaceChildren( ...people.map( ( person ) => personNode( person, mode ) ) )
}

const renderHeadline = () => {
	const arrivals = newArrivals()
	const total = activeAttendees().length
	const previousTotal = totalAtLastCheck()

	const countNode = el( "new-count" )

	countNode.textContent = String( arrivals.length )
	countNode.classList.toggle( "is-zero", 0 === arrivals.length )

	el( "total-count" ).textContent = total.toLocaleString()

	const delta = el( "total-delta" )

	if ( null !== previousTotal && total !== previousTotal ) {
		const change = total - previousTotal

		delta.textContent = `${ change > 0 ? "+" : "" }${ change.toLocaleString() } since your last check`
		delta.classList.toggle( "is-up", change > 0 )
	} else {
		delta.textContent = ""
		delta.classList.remove( "is-up" )
	}

	/*
	 * "Last change" rather than "data updated": the roster genuinely sits unchanged
	 * overnight, and phrasing it as an update made a working tracker read as stale. When
	 * the source was last POLLED is a separate fact, shown by the pulse below.
	 */
	const meta = []

	if ( state.lastChecked ) {
		meta.push( `You marked this checked ${ shortTime( state.lastChecked ) }` )
	} else {
		meta.push( "You have not marked this list as checked yet" )
	}

	meta.push( `last change ${ relativeTime( state.data.updated_at ) }` )
	el( "headline-meta" ).textContent = meta.join( " · " )

	el( "sync-note" ).textContent = "shared" === state.markerMode
		? "Shared across your devices"
		: "Saved in this browser only"
}

/**
 * Shows when the poller last completed successfully.
 *
 * Without this the page cannot tell "healthy but nothing has changed" apart from "the
 * pipeline broke six hours ago" -- both look identical when the only timestamp on screen
 * is when the data last changed. An attendee list routinely goes ten hours unchanged
 * overnight, so that ambiguity is the normal case, not an edge case.
 *
 * Reads the public GitHub Actions API with no token. Any failure (private repo, rate
 * limit, network) leaves the indicator hidden rather than showing something wrong.
 *
 * @since  [NEXT_VERSION]
 *
 * @return {Promise<void>}
 */
const renderPollStatus = async () => {
	if ( ! CONFIG.githubRepo ) {
		return
	}

	const endpoint = `https://api.github.com/repos/${ CONFIG.githubRepo }/actions/workflows/${ CONFIG.pollWorkflow }/runs?per_page=1&status=success`

	let lastRun = null

	try {
		const response = await fetch( endpoint, { headers: { accept: "application/vnd.github+json" } } )

		if ( ! response.ok ) {
			return
		}

		lastRun = ( await response.json() ).workflow_runs?.[ 0 ]?.updated_at ?? null
	} catch {
		return
	}

	if ( ! lastRun ) {
		return
	}

	const ageMinutes = ( Date.now() - new Date( lastRun ).getTime() ) / 60_000
	const isStale = ageMinutes > CONFIG.staleAfterMinutes
	const node = el( "poll-status" )

	node.hidden = false
	node.classList.toggle( "is-stale", isStale )
	node.title = `Last successful poll: ${ exactTime( lastRun ) }`

	el( "poll-status-text" ).textContent = isStale
		? `Source last polled ${ relativeTime( lastRun ) } — the poller may have stalled`
		: `Source checked ${ relativeTime( lastRun ) }`
}

const renderArrivals = () => {
	const arrivals = newArrivals()
	const section = el( "arrivals-section" )

	section.hidden = 0 === arrivals.length

	if ( 0 === arrivals.length ) {
		return
	}

	el( "arrivals-sub" ).textContent = state.lastChecked
		? `${ arrivals.length } ${ plural( arrivals.length, "person", "people" ) } added since ${ shortTime( state.lastChecked ) }.`
		: `${ arrivals.length } ${ plural( arrivals.length, "person", "people" ) } added since tracking began.`

	fillList( el( "arrivals" ), arrivals, "arrival" )
}

const renderDepartures = () => {
	const departures = recentDepartures()
	const section = el( "departures-section" )

	section.hidden = 0 === departures.length

	if ( 0 === departures.length ) {
		return
	}

	el( "departures-sub" ).textContent = `${ departures.length } ${ plural( departures.length, "person", "people" ) } no longer listed on the source page.`
	fillList( el( "departures" ), departures, "departed" )
}

const filteredRoster = () => {
	const query = state.query.trim().toLowerCase()
	let people = activeAttendees()

	if ( query ) {
		people = people.filter( ( person ) => {
			return [ person.first, person.last, person.job_title, person.company ]
				.join( " " )
				.toLowerCase()
				.includes( query )
		} )
	}

	if ( "alpha" === state.sort ) {
		return people.sort( ( a, b ) => {
			return a.first.localeCompare( b.first ) || a.last.localeCompare( b.last )
		} )
	}

	/*
	 * Recently-added first. Baseline records have no real date, so they sort to the end
	 * rather than pretending to share the tracking start timestamp.
	 */
	return people.sort( ( a, b ) => {
		if ( Boolean( a.baseline ) !== Boolean( b.baseline ) ) {
			return a.baseline ? 1 : -1
		}

		if ( a.baseline ) {
			return a.first.localeCompare( b.first ) || a.last.localeCompare( b.last )
		}

		return b.added_at.localeCompare( a.added_at )
	} )
}

const renderRoster = () => {
	const people = filteredRoster()
	const shown = people.slice( 0, state.visible )
	const list = el( "roster" )

	list.replaceChildren()

	let dividerPlaced = false

	for ( const person of shown ) {
		if ( "recent" === state.sort && person.baseline && ! dividerPlaced ) {
			const divider = document.createElement( "li" )

			divider.className = "roster__divider"
			divider.textContent = "Already listed when tracking started"
			list.append( divider )
			dividerPlaced = true
		}

		list.append( personNode( person, "roster" ) )
	}

	el( "roster-count" ).textContent = state.query
		? `${ people.length } of ${ activeAttendees().length } shown`
		: `${ people.length.toLocaleString() } attendees`

	const more = el( "show-more" )

	more.hidden = shown.length >= people.length
	more.textContent = `Show more (${ ( people.length - shown.length ).toLocaleString() } remaining)`
}

const renderGrowth = () => {
	renderGrowthChart( el( "growth-chart" ), state.runs )

	const sub = el( "growth-sub" )

	if ( state.runs.length < 2 ) {
		sub.textContent = "A line appears here once the tracker has recorded more than one count."
	} else {
		const first = state.runs[ 0 ]
		const last = state.runs[ state.runs.length - 1 ]
		const change = last.total - first.total

		sub.textContent = `${ change >= 0 ? "+" : "" }${ change.toLocaleString() } since tracking began on ${ shortTime( first.at ) }.`
	}

	const body = el( "growth-table" ).querySelector( "tbody" )

	body.replaceChildren( ...[ ...state.runs ].reverse().map( ( point ) => {
		const row = document.createElement( "tr" )

		for ( const value of [ shortTime( point.at ), point.total.toLocaleString(), point.arrived ?? 0, point.departed ?? 0 ] ) {
			const cell = document.createElement( "td" )

			cell.textContent = String( value )
			row.append( cell )
		}

		return row
	} ) )
}

const renderFooter = () => {
	const footer = el( "footer-source" )

	footer.replaceChildren( document.createTextNode( "Source: " ) )

	const link = document.createElement( "a" )

	link.href = state.data.source_url
	link.textContent = state.data.source_url
	link.rel = "noopener noreferrer"
	link.target = "_blank"
	footer.append( link )
}

const renderAll = () => {
	renderHeadline()
	renderArrivals()
	renderDepartures()
	renderGrowth()
	renderRoster()
	renderFooter()

	document.title = `${ newArrivals().length } new · ${ state.data.name }`
}

/* ---------- Loading ---------- */

const loadJson = async ( path, fallback ) => {
	const response = await fetch( path, { cache: "no-store" } )

	if ( ! response.ok ) {
		if ( undefined !== fallback ) {
			return fallback
		}

		throw new Error( `Could not load ${ path } (HTTP ${ response.status }).` )
	}

	return await response.json()
}

const loadEvent = async ( event ) => {
	state.event = event
	state.data = await loadJson( `data/${ event.slug }/attendees.json` )
	state.runs = ( await loadJson( `data/${ event.slug }/runs.json`, { points: [] } ) ).points ?? []
	state.lastChecked = await readMarker( event.slug )
	state.visible = ROSTER_PAGE_SIZE

	renderAll()

	// Not awaited: the page is complete without it, and GitHub should never delay render.
	renderPollStatus()
}

const setupEventSwitcher = ( events ) => {
	const select = el( "event-select" )

	if ( events.length < 2 ) {
		return
	}

	select.hidden = false
	select.replaceChildren( ...events.map( ( event ) => {
		const option = document.createElement( "option" )

		option.value = event.slug
		option.textContent = event.name

		return option
	} ) )

	select.value = state.event.slug
	select.addEventListener( "change", async () => {
		const next = events.find( ( event ) => event.slug === select.value )

		const url = new URL( location.href )

		url.searchParams.set( "event", next.slug )
		history.replaceState( null, "", url )

		await loadEvent( next )
	} )
}

/* ---------- Wiring ---------- */

const setupTheme = () => {
	const stored = localStorage.getItem( "wcat:theme" )

	if ( stored ) {
		document.documentElement.dataset.theme = stored
	}

	el( "theme-toggle" ).addEventListener( "click", () => {
		const prefersDark = matchMedia( "(prefers-color-scheme: dark)" ).matches
		const current = document.documentElement.dataset.theme || ( prefersDark ? "dark" : "light" )
		const next = "dark" === current ? "light" : "dark"

		document.documentElement.dataset.theme = next
		localStorage.setItem( "wcat:theme", next )

		// The chart reads its colors from CSS custom properties, so it needs a repaint.
		renderGrowth()
	} )
}

const setupControls = () => {
	el( "search" ).addEventListener( "input", ( event ) => {
		state.query = event.target.value
		state.visible = ROSTER_PAGE_SIZE
		renderRoster()
	} )

	for ( const button of document.querySelectorAll( ".segmented__option" ) ) {
		button.addEventListener( "click", () => {
			state.sort = button.dataset.sort
			state.visible = ROSTER_PAGE_SIZE

			for ( const other of document.querySelectorAll( ".segmented__option" ) ) {
				const selected = other === button

				other.classList.toggle( "is-selected", selected )
				other.setAttribute( "aria-pressed", String( selected ) )
			}

			renderRoster()
		} )
	}

	el( "show-more" ).addEventListener( "click", () => {
		state.visible += ROSTER_PAGE_SIZE
		renderRoster()
	} )

	el( "mark-checked" ).addEventListener( "click", async () => {
		const button = el( "mark-checked" )

		button.disabled = true
		button.textContent = "Saving…"

		/*
		 * Stamped with the data snapshot actually on screen, not the moment of the click.
		 * Using "now" would mark anyone who arrived between page load and the button press
		 * as already seen, which is exactly the thing this page exists to prevent.
		 */
		await writeMarker( state.event.slug, state.data.updated_at )

		state.lastChecked = state.data.updated_at
		renderAll()

		button.disabled = false
		button.textContent = "Mark as checked"
	} )
}

const main = async () => {
	setupTheme()

	try {
		const manifest = await loadJson( "data/events.json", { events: [] } )
		const events = manifest.events ?? []

		if ( 0 === events.length ) {
			throw new Error( "No events found. Run `npm run poll` to generate the tracker data." )
		}

		const requested = new URL( location.href ).searchParams.get( "event" )
		const chosen = events.find( ( event ) => event.slug === requested ) ?? events[ 0 ]

		await loadEvent( chosen )
		setupEventSwitcher( events )
		setupControls()

		el( "loading" ).hidden = true
		el( "content" ).hidden = false
	} catch ( error ) {
		el( "loading" ).hidden = true

		const notice = el( "error" )

		notice.hidden = false
		notice.textContent = error.message
	}
}

main()
