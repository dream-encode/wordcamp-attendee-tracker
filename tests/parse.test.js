import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseAttendees, attendeeKey } from "../scripts/lib/fetch-attendees.js"
import { buildPage, gravatarHash } from "./helpers/build-page.js"

describe( "parseAttendees", () => {
	it( "extracts every field and normalizes CampTix whitespace padding", () => {
		const html = buildPage( [
			{ first: "Aaron", last: "Campbell", title: "VP Product", company: "Monarx.com", url: "https://Monarx.com", email: "aaron@example.test" }
		] )

		const [ person ] = parseAttendees( html )

		assert.equal( person.first, "Aaron" )
		assert.equal( person.last, "Campbell" )
		assert.equal( person.job_title, "VP Product" )
		assert.equal( person.company, "Monarx.com" )
		assert.equal( person.company_url, "https://Monarx.com" )
		assert.equal( person.gravatar_hash, gravatarHash( "aaron@example.test" ) )
	} )

	it( "decodes the company label CampTix URL-escaped", () => {
		/*
		 * The company field is free text, but CampTix escapes it for the anchor and reuses
		 * the escaped string as the link text. 61 of the 628 WCUS 2026 entries arrive this way.
		 */
		const html = buildPage( [
			{ first: "Theresa", last: "Newman", company: "Haymarket%20Media", url: "http://Haymarket%20Media" }
		] )

		assert.equal( parseAttendees( html )[ 0 ].company, "Haymarket Media" )
	} )

	it( "leaves a company containing a literal percent sign alone", () => {
		const html = buildPage( [ { first: "Pat", last: "Doe", company: "100% Design" } ] )

		assert.equal( parseAttendees( html )[ 0 ].company, "100% Design" )
	} )

	it( "throws rather than returning empty when the container is missing", () => {
		const html = buildPage( [ { first: "A", last: "B" } ], { omitContainer: true } )

		assert.throws( () => parseAttendees( html ), /no #tix-attendees container/ )
	} )

	it( "throws when the container holds no rows", () => {
		assert.throws( () => parseAttendees( buildPage( [] ) ), /zero attendee rows/ )
	} )

	it( "skips rows carrying no name at all", () => {
		const html = buildPage( [
			{ first: "Real", last: "Person" },
			{ nameless: true }
		] )

		const people = parseAttendees( html )

		assert.equal( people.length, 1 )
		assert.equal( people[ 0 ].first, "Real" )
	} )
} )

describe( "attendeeKey", () => {
	it( "separates two people sharing one email", () => {
		/*
		 * Real case from WCUS 2026: Amy Elizabeth and Tripper Gawan share a Gravatar hash
		 * because one bought both tickets. Keying on the hash alone would merge them and
		 * silently swallow one arrival.
		 */
		const shared = gravatarHash( "amy@example.test" )

		assert.notEqual(
			attendeeKey( shared, "Amy", "Elizabeth" ),
			attendeeKey( shared, "Tripper", "Gawan" )
		)
	} )

	it( "is case-insensitive on the name", () => {
		const hash = gravatarHash( "x@example.test" )

		assert.equal( attendeeKey( hash, "Ada", "Lovelace" ), attendeeKey( hash, "ADA", "lovelace" ) )
	} )
} )
