import { createHash } from "node:crypto"

/*
 * Builds CampTix-shaped HTML from a compact person description, so tests read as data
 * rather than as markup. Mirrors the real structure emitted by [camptix_attendees],
 * including the two tix-badge-* fields the parser is expected to ignore.
 */

/**
 * Deterministic stand-in for the SHA-256-of-email Gravatar hash.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} seed Any stable seed, usually an email.
 * @return {string}      64-character hex hash.
 */
export const gravatarHash = ( seed ) => {
	return createHash( "sha256" ).update( seed ).digest( "hex" )
}

/**
 * Renders an attendee list page.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {Array<object>} people  Person descriptors.
 * @param  {object}        options Options.
 * @param  {boolean}       options.omitContainer Render without #tix-attendees.
 * @return {string}                Page HTML.
 */
export const buildPage = ( people, { omitContainer = false } = {} ) => {
	const rows = people.map( ( person ) => {
		const hash = person.hash ?? gravatarHash( person.email ?? `${ person.first }.${ person.last }@example.test` )
		const name = person.nameless
			? '<div class="tix-field tix-attendee-name"></div>'
			: `<div class="tix-field tix-attendee-name">
					<span class="tix-first">${ person.first }</span> <span class="tix-last">${ person.last }</span>
				</div>`

		return `<li>
			<img alt='' src='https://secure.gravatar.com/avatar/${ hash }?s=96&#038;d=blank&#038;r=g' srcset='https://secure.gravatar.com/avatar/${ hash }?s=192 2x' class='avatar avatar-96 photo' height='96' width='96' loading='lazy' decoding='async'/>
			${ name }
			<div class="tix-field tix-badge-first-name-this-will-be-printed-on-your-name-badge">${ person.first ?? "" }</div>
			<div class="tix-field tix-badge-last-name-this-will-be-printed-on-your-name-badge">${ person.last ?? "" }</div>
			<div class="tix-field tix-job-title">
					${ person.title ?? "" }				</div>
			<a class="tix-field tix-attendee-url" href="${ person.url ?? "" }">${ person.company ?? "" }</a>
		</li>`
	} ).join( "\n" )

	const list = `<ul class="tix-attendee-list tix-columns-4">${ rows }</ul>`
	const body = omitContainer ? list : `<div id="tix-attendees">${ list }</div>`

	return `<!doctype html><html><body><main>${ body }</main></body></html>`
}
