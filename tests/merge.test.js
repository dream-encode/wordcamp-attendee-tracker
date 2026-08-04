import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseAttendees } from "../scripts/lib/fetch-attendees.js"
import { dedupeAttendees, mergeAttendees, countActive, assertRosterPlausible } from "../scripts/lib/merge.js"
import { buildPage, gravatarHash } from "./helpers/build-page.js"

const T1 = "2026-08-04T10:00:00.000Z"
const T2 = "2026-08-04T18:00:00.000Z"
const T3 = "2026-08-05T09:00:00.000Z"

/**
 * Parses and dedupes a page in one step, as poll.js does.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} people Person descriptors.
 * @return {{ people: Array<object>, rows: number }} Deduped roster.
 */
const roster = ( people ) => {
	return dedupeAttendees( parseAttendees( buildPage( people ) ) )
}

describe( "dedupeAttendees", () => {
	it( "collapses duplicate ticket registrations into one person", () => {
		/* Real case: Leandro Cappello appears three times on the WCUS 2026 list. */
		const { people, rows } = roster( [
			{ first: "Leandro", last: "Cappello", title: "Engineer DevOps", company: "wpidea.it", email: "l@example.test" },
			{ first: "Leandro", last: "Cappello", title: "Engineer DevOps", company: "wpidea.it", email: "l@example.test" },
			{ first: "Leandro", last: "Cappello", title: "Engineer DevOps", company: "wpidea.it", email: "l@example.test" }
		] )

		assert.equal( rows, 3 )
		assert.equal( people.length, 1 )
		assert.equal( people[ 0 ].ticket_rows, 3 )
	} )

	it( "picks the same winner regardless of row order", () => {
		/*
		 * Real case: Emma Young's two rows carry different job titles. If the winner were
		 * "first row seen", a reordering upstream would flip the stored value and fake a
		 * change on an otherwise unchanged poll.
		 */
		const a = { first: "Emma", last: "Young", title: "Head of Organic Marketing", company: "hostinger.com", email: "e@example.test" }
		const b = { first: "Emma", last: "Young", title: "Hostinger", company: "hostinger.com", email: "e@example.test" }

		const forward = roster( [ a, b ] ).people[ 0 ]
		const reversed = roster( [ b, a ] ).people[ 0 ]

		assert.deepEqual( forward, reversed )
	} )

	it( "keeps two people who share one email but differ by name", () => {
		const { people } = roster( [
			{ first: "Amy", last: "Elizabeth", email: "amy@example.test" },
			{ first: "Tripper", last: "Gawan", email: "amy@example.test" }
		] )

		assert.equal( people.length, 2 )
	} )
} )

describe( "mergeAttendees", () => {
	it( "marks the first ever import as baseline and excludes it from real arrivals", () => {
		const { people } = roster( [ { first: "Ada", last: "Lovelace" }, { first: "Alan", last: "Turing" } ] )
		const { attendees } = mergeAttendees( [], people, T1, true )

		assert.equal( attendees.length, 2 )
		assert.ok( attendees.every( ( person ) => true === person.baseline ) )
		assert.ok( attendees.every( ( person ) => person.added_at === T1 ) )
	} )

	it( "stamps added_at on a genuine arrival, not as baseline", () => {
		const first = mergeAttendees( [], roster( [ { first: "Ada", last: "Lovelace" } ] ).people, T1, true )

		const second = mergeAttendees(
			first.attendees,
			roster( [ { first: "Ada", last: "Lovelace" }, { first: "Grace", last: "Hopper" } ] ).people,
			T2,
			false
		)

		assert.equal( second.arrived.length, 1 )
		assert.equal( second.arrived[ 0 ].first, "Grace" )
		assert.equal( second.arrived[ 0 ].added_at, T2 )
		assert.equal( second.arrived[ 0 ].baseline, false )
	} )

	it( "never rewrites added_at when a mutable field changes", () => {
		const first = mergeAttendees( [], roster( [ { first: "Ada", last: "Lovelace", title: "Engineer" } ] ).people, T1, true )

		const second = mergeAttendees(
			first.attendees,
			roster( [ { first: "Ada", last: "Lovelace", title: "Principal Engineer" } ] ).people,
			T2,
			false
		)

		assert.equal( second.arrived.length, 0 )
		assert.equal( second.updated.length, 1 )
		assert.deepEqual( second.updated[ 0 ].changes, [ "job_title" ] )
		assert.equal( second.attendees[ 0 ].added_at, T1, "added_at must survive an edit" )
		assert.equal( second.attendees[ 0 ].job_title, "Principal Engineer" )
	} )

	it( "stamps a departure once and does not re-report it on later polls", () => {
		const first = mergeAttendees(
			[],
			roster( [ { first: "Ada", last: "Lovelace" }, { first: "Grace", last: "Hopper" } ] ).people,
			T1,
			true
		)

		const second = mergeAttendees( first.attendees, roster( [ { first: "Ada", last: "Lovelace" } ] ).people, T2, false )

		assert.equal( second.departed.length, 1 )
		assert.equal( second.departed[ 0 ].first, "Grace" )
		assert.equal( second.departed[ 0 ].departed_at, T2 )
		assert.equal( countActive( second.attendees ), 1 )

		const third = mergeAttendees( second.attendees, roster( [ { first: "Ada", last: "Lovelace" } ] ).people, T3, false )

		assert.equal( third.departed.length, 0, "a departure is reported the run it happens, not forever" )
		assert.equal( third.attendees.find( ( p ) => "Grace" === p.first ).departed_at, T2 )
	} )

	it( "keeps the original added_at when someone departs and returns", () => {
		const people = roster( [ { first: "Ada", last: "Lovelace" }, { first: "Grace", last: "Hopper" } ] ).people
		const first = mergeAttendees( [], people, T1, true )
		const second = mergeAttendees( first.attendees, roster( [ { first: "Ada", last: "Lovelace" } ] ).people, T2, false )
		const third = mergeAttendees( second.attendees, people, T3, false )

		const grace = third.attendees.find( ( person ) => "Grace" === person.first )

		assert.equal( third.returned.length, 1 )
		assert.equal( third.arrived.length, 0, "a return is not a new arrival" )
		assert.equal( grace.departed_at, null )
		assert.equal( grace.added_at, T1, "returning must not reset added_at" )
	} )

	it( "sorts by key so a person never moves once written", () => {
		const { people } = roster( [
			{ first: "Zoe", last: "Zed" },
			{ first: "Ada", last: "Lovelace" },
			{ first: "Grace", last: "Hopper" }
		] )

		const { attendees } = mergeAttendees( [], people, T1, true )
		const keys = attendees.map( ( person ) => person.key )

		assert.deepEqual( keys, [ ...keys ].sort( ( a, b ) => a.localeCompare( b ) ) )
	} )

	it( "produces an identical result for an unchanged roster", () => {
		const people = roster( [ { first: "Ada", last: "Lovelace" }, { first: "Grace", last: "Hopper" } ] ).people
		const first = mergeAttendees( [], people, T1, true )
		const second = mergeAttendees( first.attendees, people, T2, false )

		assert.deepEqual( second.attendees, first.attendees, "an unchanged poll must not alter the record" )
		assert.equal( second.arrived.length, 0 )
		assert.equal( second.departed.length, 0 )
		assert.equal( second.updated.length, 0 )
	} )
} )

describe( "assertRosterPlausible", () => {
	it( "allows normal growth and small churn", () => {
		assert.doesNotThrow( () => assertRosterPlausible( 640, 633 ) )
		assert.doesNotThrow( () => assertRosterPlausible( 600, 633 ) )
	} )

	it( "refuses a truncated response that would mass-depart the roster", () => {
		assert.throws( () => assertRosterPlausible( 12, 633 ), /drop guard tripped/ )
	} )

	it( "allows the drop when explicitly forced", () => {
		assert.doesNotThrow( () => assertRosterPlausible( 12, 633, { force: true } ) )
	} )

	it( "does not fire on the baseline run", () => {
		assert.doesNotThrow( () => assertRosterPlausible( 633, 0 ) )
	} )

	it( "names the event so a failed cron run is diagnosable", () => {
		assert.throws( () => assertRosterPlausible( 1, 633, { label: "wcus-2026" } ), /wcus-2026/ )
	} )
} )

describe( "gravatar hash extraction", () => {
	it( "reads the hash out of the avatar URL", () => {
		const { people } = roster( [ { first: "Ada", last: "Lovelace", email: "ada@example.test" } ] )

		assert.equal( people[ 0 ].gravatar_hash, gravatarHash( "ada@example.test" ) )
	} )
} )
