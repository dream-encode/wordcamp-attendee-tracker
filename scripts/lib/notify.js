import nodemailer from "nodemailer"

/*
 * SMTP notification for polls that found arrivals or departures.
 *
 * Leads with the same two numbers the site leads with -- how many are new, and how many
 * there are in total -- so the email answers the question without needing the site open.
 *
 * Silently no-ops when SMTP is not configured. Local dry runs and forks should not fail
 * just because there are no mail secrets; the poll itself is the important part, and its
 * data is already committed by the time this runs.
 */

const REQUIRED_ENV = [ "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_TO" ]

/**
 * Escapes text for interpolation into the HTML body.
 *
 * Attendee names, job titles and company strings are attacker-controllable free text from
 * a public registration form, so they never go into markup raw.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} value Raw text.
 * @return {string}       HTML-safe text.
 */
const escapeHtml = ( value ) => {
	return String( value ?? "" )
		.replace( /&/g, "&amp;" )
		.replace( /</g, "&lt;" )
		.replace( />/g, "&gt;" )
		.replace( /"/g, "&quot;" )
}

/**
 * Formats one attendee as a single line of text.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {object} person Attendee record.
 * @return {string}        Display line.
 */
const personLine = ( person ) => {
	const parts = [ `${ person.first } ${ person.last }`.trim() ]

	if ( person.job_title ) {
		parts.push( person.job_title )
	}

	if ( person.company ) {
		parts.push( person.company )
	}

	return parts.join( " -- " )
}

/**
 * Builds the subject line, leading with the new count.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} summaries Event summaries that had movement.
 * @return {string}                  Subject line.
 */
const buildSubject = ( summaries ) => {
	const arrived = summaries.reduce( ( sum, summary ) => sum + summary.arrived.length, 0 )
	const total = summaries.reduce( ( sum, summary ) => sum + summary.total, 0 )

	if ( 1 === summaries.length ) {
		const summary = summaries[ 0 ]
		const lead = summary.arrived.length > 0
			? `${ summary.arrived.length } new attendee${ 1 === summary.arrived.length ? "" : "s" }`
			: `${ summary.departed.length } attendee${ 1 === summary.departed.length ? "" : "s" } removed`

		return `${ lead } -- ${ summary.name } (${ summary.total } total)`
	}

	return `${ arrived } new attendees across ${ summaries.length } events (${ total } total)`
}

/**
 * Renders the plain-text body.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} summaries Event summaries that had movement.
 * @return {string}                  Plain-text body.
 */
const buildText = ( summaries ) => {
	const blocks = summaries.map( ( summary ) => {
		const lines = [
			summary.name,
			`${ summary.arrived.length } new since the last check -- ${ summary.total } attendees total`,
			""
		]

		for ( const person of summary.arrived ) {
			lines.push( `  + ${ personLine( person ) }` )
		}

		if ( summary.departed.length > 0 ) {
			lines.push( "", `Removed from the list (${ summary.departed.length }):` )

			for ( const person of summary.departed ) {
				lines.push( `  - ${ personLine( person ) }` )
			}
		}

		lines.push( "", summary.url )

		return lines.join( "\n" )
	} )

	return blocks.join( "\n\n---\n\n" )
}

/**
 * Renders the HTML body.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} summaries Event summaries that had movement.
 * @return {string}                  HTML body.
 */
const buildHtml = ( summaries ) => {
	const siteUrl = process.env.SITE_URL || ""

	const blocks = summaries.map( ( summary ) => {
		const arrivals = summary.arrived
			.map( ( person ) => `<li>${ escapeHtml( personLine( person ) ) }</li>` )
			.join( "" )

		const departures = summary.departed.length > 0
			? `<p style="margin:24px 0 8px;font-weight:600;">Removed from the list (${ summary.departed.length })</p>
				<ul style="margin:0;padding-left:20px;color:#6b7280;">${
	summary.departed.map( ( person ) => `<li>${ escapeHtml( personLine( person ) ) }</li>` ).join( "" )
}</ul>`
			: ""

		return `<h2 style="margin:0 0 4px;font-size:18px;">${ escapeHtml( summary.name ) }</h2>
			<p style="margin:0 0 16px;font-size:24px;font-weight:700;">
				${ summary.arrived.length } new
				<span style="font-weight:400;color:#6b7280;font-size:16px;">since the last check &middot; ${ summary.total } total</span>
			</p>
			<ul style="margin:0;padding-left:20px;line-height:1.6;">${ arrivals }</ul>
			${ departures }
			<p style="margin:24px 0 0;font-size:13px;">
				<a href="${ escapeHtml( summary.url ) }">Source list</a>${ siteUrl ? ` &middot; <a href="${ escapeHtml( siteUrl ) }">Open the tracker</a>` : "" }
			</p>`
	} )

	return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;max-width:640px;">${
		blocks.join( '<hr style="margin:32px 0;border:0;border-top:1px solid #e5e7eb;">' )
	}</div>`
}

/**
 * Sends the summary email, if SMTP is configured.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} summaries Event summaries that had arrivals or departures.
 * @return {Promise<boolean>}        True when a message was sent.
 */
export const sendSummaryEmail = async ( summaries ) => {
	const missing = REQUIRED_ENV.filter( ( name ) => ! process.env[ name ] )

	if ( missing.length > 0 ) {
		console.log( `Email skipped -- SMTP not configured (missing ${ missing.join( ", " ) }).` )

		return false
	}

	const port = Number( process.env.SMTP_PORT || 587 )

	const transport = nodemailer.createTransport( {
		host: process.env.SMTP_HOST,
		port,
		secure: 465 === port,
		auth: {
			user: process.env.SMTP_USER,
			pass: process.env.SMTP_PASS
		}
	} )

	await transport.sendMail( {
		from: process.env.SMTP_FROM,
		to: process.env.SMTP_TO,
		subject: buildSubject( summaries ),
		text: buildText( summaries ),
		html: buildHtml( summaries )
	} )

	console.log( `Email sent to ${ process.env.SMTP_TO }.` )

	return true
}
