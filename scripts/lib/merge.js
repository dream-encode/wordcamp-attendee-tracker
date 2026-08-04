/*
 * Seen-set merge: turns a freshly parsed roster into the stamped, historical record.
 *
 * This is where the actual product lives. The source page publishes WHO is attending and
 * nothing else -- no dates, no feed, no ordering by recency. `added_at` does not exist
 * anywhere upstream; it comes into being here, the first time we observe a person, and is
 * never recomputed afterwards.
 *
 * Everything in this module is pure. Fetching lives in fetch-attendees.js, file IO and the
 * safety guards live in poll.js, so the merge can be exercised against fixtures.
 */

/**
 * Fields that reflect the current state of a registration rather than its history.
 * These are refreshed from the live page on every poll; the history fields are not.
 */
const MUTABLE_FIELDS = [ "first", "last", "job_title", "company", "company_url", "gravatar_hash" ]

/**
 * Collapses duplicate ticket registrations into one record per person.
 *
 * WCUS 2026 lists 633 rows for 627 people -- five registrants appear more than once
 * (Leandro Cappello three times) because they bought multiple tickets under one email.
 * The tracker counts humans, not tickets.
 *
 * The winner within a duplicate group is chosen by sorting the group, NOT by taking the
 * first row seen. Duplicates are not always byte-identical -- one Emma Young row reads
 * "Head of Organic Marketing" and the other reads "Hostinger" -- so relying on page order
 * would flip the stored value whenever CampTix happened to emit the rows the other way
 * round, producing a phantom change on an otherwise unchanged poll.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} parsed Records straight from the parser, in page order.
 * @return {{ people: Array<object>, rows: number }} Deduped people plus the raw row count.
 */
export const dedupeAttendees = ( parsed ) => {
	const groups = new Map()

	for ( const record of parsed ) {
		const group = groups.get( record.key ) || []

		group.push( record )
		groups.set( record.key, group )
	}

	const people = []

	for ( const group of groups.values() ) {
		const ordered = [ ...group ].sort( ( a, b ) => {
			return ( a.job_title || "" ).localeCompare( b.job_title || "" )
				|| ( a.company || "" ).localeCompare( b.company || "" )
				|| ( a.company_url || "" ).localeCompare( b.company_url || "" )
		} )

		const winner = { ...ordered[ 0 ] }

		if ( group.length > 1 ) {
			winner.ticket_rows = group.length
		}

		people.push( winner )
	}

	return { people, rows: parsed.length }
}

/**
 * Merges the current roster into the stored record, stamping arrivals and departures.
 *
 * `added_at` is written once, on first sighting, and never touched again -- not on a field
 * edit, not when someone departs and returns. It is the only piece of data here that
 * cannot be re-derived if lost, which is why the caller guards hard against acting on a
 * truncated fetch.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} stored     Previously stored attendee records.
 * @param  {Array<object>} current    Deduped records from this poll.
 * @param  {string}        now        ISO8601 timestamp for this run.
 * @param  {boolean}       isBaseline True when this is the first ever run for the event.
 * @return {object}                   Merged attendees plus arrival/departure/update detail.
 */
export const mergeAttendees = ( stored, current, now, isBaseline ) => {
	const storedByKey = new Map( stored.map( ( record ) => [ record.key, record ] ) )
	const currentByKey = new Map( current.map( ( record ) => [ record.key, record ] ) )

	const merged = []
	const arrived = []
	const departed = []
	const returned = []
	const updated = []

	for ( const [ key, incoming ] of currentByKey ) {
		const existing = storedByKey.get( key )

		if ( ! existing ) {
			const record = {
				key,
				...pickMutable( incoming ),
				added_at: now,
				departed_at: null,
				baseline: Boolean( isBaseline )
			}

			if ( incoming.ticket_rows ) {
				record.ticket_rows = incoming.ticket_rows
			}

			merged.push( record )
			arrived.push( record )

			continue
		}

		const record = {
			key,
			...pickMutable( incoming ),
			added_at: existing.added_at,
			departed_at: null,
			baseline: Boolean( existing.baseline )
		}

		if ( incoming.ticket_rows ) {
			record.ticket_rows = incoming.ticket_rows
		}

		// Someone who vanished and came back keeps their original added_at.
		if ( existing.departed_at ) {
			returned.push( record )
		}

		const changes = MUTABLE_FIELDS.filter( ( field ) => existing[ field ] !== record[ field ] )

		if ( changes.length > 0 ) {
			updated.push( { key, first: record.first, last: record.last, changes } )
		}

		merged.push( record )
	}

	for ( const [ key, existing ] of storedByKey ) {
		if ( currentByKey.has( key ) ) {
			continue
		}

		const record = {
			...existing,
			departed_at: existing.departed_at || now
		}

		// Only count it as a departure the run it actually happens.
		if ( ! existing.departed_at ) {
			departed.push( record )
		}

		merged.push( record )
	}

	/*
	 * Sorted by key so a person's position in the file never changes once written. Git
	 * diffs then show arrivals as clean insertions instead of a reshuffled array.
	 */
	merged.sort( ( a, b ) => a.key.localeCompare( b.key ) )

	return { attendees: merged, arrived, departed, returned, updated }
}

/**
 * Extracts just the live-state fields from a parsed record.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} record Parsed attendee record.
 * @return {object}        The mutable fields only.
 */
const pickMutable = ( record ) => {
	const picked = {}

	for ( const field of MUTABLE_FIELDS ) {
		picked[ field ] = record[ field ] || ""
	}

	return picked
}

/**
 * Counts attendees currently on the list (i.e. not departed).
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} attendees Merged attendee records.
 * @return {number}                  Active attendee count.
 */
export const countActive = ( attendees ) => {
	return attendees.filter( ( record ) => ! record.departed_at ).length
}

/**
 * If a poll returns fewer than this fraction of the previous roster, treat the response as
 * truncated rather than believing it.
 */
export const DROP_GUARD_RATIO = 0.8

/**
 * Throws when a roster shrinks implausibly between polls.
 *
 * A partial, cached or rate-limited response is indistinguishable from a genuine mass
 * departure. Acting on one would stamp departed_at across the whole roster, and when the
 * next good poll brought everyone back they would all look like fresh arrivals -- which
 * would overwrite every added_at with the wrong date. added_at is the only value in this
 * system that cannot be recomputed from the source, so the failure is unrecoverable and
 * the guard refuses rather than risks it.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {number}  currentCount  Attendees parsed this poll.
 * @param  {number}  previousCount Active attendees at the previous poll.
 * @param  {object}  options       Options.
 * @param  {boolean} options.force Bypass the guard for a genuine mass departure.
 * @param  {string}  options.label Event label, used in the error message.
 * @return {void}
 */
export const assertRosterPlausible = ( currentCount, previousCount, { force = false, label = "event" } = {} ) => {
	if ( force || 0 === previousCount ) {
		return
	}

	if ( currentCount >= previousCount * DROP_GUARD_RATIO ) {
		return
	}

	throw new Error(
		`Roster drop guard tripped for ${ label }: got ${ currentCount } attendees, previous run had ${ previousCount }. ` +
		"Refusing to write, since a truncated response would mass-depart the roster and destroy added_at. " +
		"Re-run when the source recovers, or pass --force if the drop is genuine."
	)
}
