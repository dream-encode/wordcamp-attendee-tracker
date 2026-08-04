/*
 * Growth timeline: one series, attendee count over time.
 *
 * One series means no legend -- the panel heading already says what is plotted, and a
 * one-swatch legend box would just restate it. The endpoint carries a direct label so the
 * current value is readable without hovering, and the panel ships a table view, so the
 * tooltip enhances rather than gates access to any value.
 *
 * Colors come from the CSS custom properties in styles.css, so light/dark and the theme
 * toggle are handled in one place. Re-run this function after a theme change.
 */

const NS = "http://www.w3.org/2000/svg"

const VIEW = {
	width: 840,
	height: 300,
	top: 16,
	right: 56,
	bottom: 34,
	left: 52
}

/**
 * Creates an SVG element with attributes.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {string} tag   Element name.
 * @param  {object} attrs Attribute map.
 * @return {SVGElement}   The element.
 */
const svgEl = ( tag, attrs = {} ) => {
	const node = document.createElementNS( NS, tag )

	for ( const [ name, value ] of Object.entries( attrs ) ) {
		node.setAttribute( name, String( value ) )
	}

	return node
}

/**
 * Rounds a domain outward to clean tick values.
 *
 * A count series that moves from 628 to 655 would be a flat line against a zero baseline,
 * so the y-axis is fitted to the data rather than anchored at zero. That is standard for a
 * trend line (and would not be acceptable for bars, whose length encodes the value).
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {number} min        Lowest value.
 * @param  {number} max        Highest value.
 * @param  {number} tickTarget Desired tick count.
 * @return {{ min: number, max: number, step: number, ticks: Array<number> }} Scale info.
 */
const niceScale = ( min, max, tickTarget = 4 ) => {
	const span = Math.max( max - min, 1 )
	const rawStep = span / tickTarget
	const magnitude = 10 ** Math.floor( Math.log10( rawStep ) )
	const step = [ 1, 2, 2.5, 5, 10 ].map( ( m ) => m * magnitude ).find( ( candidate ) => candidate >= rawStep ) ?? 10 * magnitude

	const niceMin = Math.floor( min / step ) * step
	const niceMax = Math.ceil( max / step ) * step
	const ticks = []

	for ( let value = niceMin; value <= niceMax + step / 2; value += step ) {
		ticks.push( Math.round( value ) )
	}

	return { min: niceMin, max: niceMax, step, ticks }
}

/**
 * Formats an x-axis tick, tightening to time-of-day for short spans.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {number}  time    Epoch milliseconds.
 * @param  {boolean} intraday True when the whole series spans under two days.
 * @return {string}          Tick label.
 */
const formatTick = ( time, intraday ) => {
	const date = new Date( time )

	if ( intraday ) {
		return date.toLocaleTimeString( undefined, { hour: "numeric", minute: "2-digit" } )
	}

	return date.toLocaleDateString( undefined, { month: "short", day: "numeric" } )
}

/**
 * Renders the growth chart into a container.
 *
 * @since  [NEXT_VERSION]
 *
 * @param  {HTMLElement}   container Target element.
 * @param  {Array<object>} points    Timeline points from runs.json.
 * @return {void}
 */
export const renderGrowthChart = ( container, points ) => {
	container.replaceChildren()

	if ( ! points || points.length < 2 ) {
		const empty = document.createElement( "p" )

		empty.className = "chart__empty"
		empty.textContent = points && 1 === points.length
			? "Only one count recorded so far. The line appears once the total changes."
			: "No counts recorded yet."

		container.append( empty )

		return
	}

	const series = points
		.map( ( point ) => ( { ...point, time: new Date( point.at ).getTime() } ) )
		.sort( ( a, b ) => a.time - b.time )

	const plotWidth = VIEW.width - VIEW.left - VIEW.right
	const plotHeight = VIEW.height - VIEW.top - VIEW.bottom

	const xMin = series[ 0 ].time
	const xMax = series[ series.length - 1 ].time
	const xSpan = Math.max( xMax - xMin, 1 )
	const intraday = xSpan < 172_800_000

	const totals = series.map( ( point ) => point.total )
	const scale = niceScale( Math.min( ...totals ), Math.max( ...totals ) )
	const ySpan = Math.max( scale.max - scale.min, 1 )

	const toX = ( time ) => VIEW.left + ( ( time - xMin ) / xSpan ) * plotWidth
	const toY = ( total ) => VIEW.top + plotHeight - ( ( total - scale.min ) / ySpan ) * plotHeight

	const wrap = document.createElement( "div" )

	wrap.className = "chart-wrap"

	const svg = svgEl( "svg", {
		viewBox: `0 0 ${ VIEW.width } ${ VIEW.height }`,
		role: "img",
		tabindex: "0",
		"aria-label": `Attendee count over time, from ${ totals[ 0 ] } to ${ totals[ totals.length - 1 ] }. A table view of the same data is below the chart.`
	} )

	// Gridlines and y ticks.
	for ( const tick of scale.ticks ) {
		const y = toY( tick )

		svg.append( svgEl( "line", {
			class: "chart__grid",
			x1: VIEW.left,
			x2: VIEW.left + plotWidth,
			y1: y,
			y2: y
		} ) )

		const label = svgEl( "text", {
			class: "chart__tick",
			x: VIEW.left - 10,
			y: y + 4,
			"text-anchor": "end"
		} )

		label.textContent = tick.toLocaleString()
		svg.append( label )
	}

	// X axis rule and ticks.
	svg.append( svgEl( "line", {
		class: "chart__axis",
		x1: VIEW.left,
		x2: VIEW.left + plotWidth,
		y1: VIEW.top + plotHeight,
		y2: VIEW.top + plotHeight
	} ) )

	const tickCount = Math.min( 5, series.length )

	for ( let index = 0; index < tickCount; index += 1 ) {
		const time = xMin + ( xSpan * index ) / Math.max( tickCount - 1, 1 )
		const anchor = 0 === index ? "start" : ( index === tickCount - 1 ? "end" : "middle" )

		const label = svgEl( "text", {
			class: "chart__tick",
			x: toX( time ),
			y: VIEW.top + plotHeight + 20,
			"text-anchor": anchor
		} )

		label.textContent = formatTick( time, intraday )
		svg.append( label )
	}

	const linePath = series.map( ( point, index ) => {
		return `${ 0 === index ? "M" : "L" }${ toX( point.time ).toFixed( 2 ) },${ toY( point.total ).toFixed( 2 ) }`
	} ).join( " " )

	const baseY = VIEW.top + plotHeight

	svg.append( svgEl( "path", {
		class: "chart__area",
		d: `${ linePath } L${ toX( xMax ).toFixed( 2 ) },${ baseY } L${ toX( xMin ).toFixed( 2 ) },${ baseY } Z`
	} ) )

	svg.append( svgEl( "path", { class: "chart__line", d: linePath } ) )

	// Endpoint marker and its direct label -- the current value without needing a hover.
	const last = series[ series.length - 1 ]

	svg.append( svgEl( "circle", {
		class: "chart__end-dot",
		cx: toX( last.time ),
		cy: toY( last.total ),
		r: 4.5
	} ) )

	const endLabel = svgEl( "text", {
		class: "chart__end-label",
		x: toX( last.time ) + 10,
		y: toY( last.total ) + 4,
		"text-anchor": "start"
	} )

	endLabel.textContent = last.total.toLocaleString()
	svg.append( endLabel )

	// Hover layer.
	const crosshair = svgEl( "line", { class: "chart__crosshair", y1: VIEW.top, y2: baseY, opacity: 0 } )
	const hoverDot = svgEl( "circle", { class: "chart__hover-dot", r: 4.5, opacity: 0 } )

	svg.append( crosshair, hoverDot )

	const tooltip = document.createElement( "div" )

	tooltip.className = "chart-tooltip"
	tooltip.hidden = true

	const showPoint = ( index ) => {
		const point = series[ index ]
		const x = toX( point.time )
		const y = toY( point.total )

		crosshair.setAttribute( "x1", x )
		crosshair.setAttribute( "x2", x )
		crosshair.setAttribute( "opacity", 1 )
		hoverDot.setAttribute( "cx", x )
		hoverDot.setAttribute( "cy", y )
		hoverDot.setAttribute( "opacity", 1 )

		const when = new Date( point.time ).toLocaleString( undefined, { dateStyle: "medium", timeStyle: "short" } )
		const movement = []

		if ( point.arrived ) {
			movement.push( `+${ point.arrived } added` )
		}

		if ( point.departed ) {
			movement.push( `-${ point.departed } removed` )
		}

		tooltip.replaceChildren()

		const value = document.createElement( "div" )

		value.className = "chart-tooltip__value"
		value.textContent = `${ point.total.toLocaleString() } attendees`

		const meta = document.createElement( "div" )

		meta.textContent = movement.length > 0 ? `${ when } · ${ movement.join( ", " ) }` : when

		tooltip.append( value, meta )
		tooltip.hidden = false

		const rect = svg.getBoundingClientRect()
		const ratio = rect.width / VIEW.width

		tooltip.style.left = `${ Math.min( Math.max( x * ratio - 60, 0 ), rect.width - tooltip.offsetWidth ) }px`
		tooltip.style.top = `${ y * ratio - tooltip.offsetHeight - 12 }px`
	}

	const hide = () => {
		crosshair.setAttribute( "opacity", 0 )
		hoverDot.setAttribute( "opacity", 0 )
		tooltip.hidden = true
	}

	const nearestIndex = ( clientX ) => {
		const rect = svg.getBoundingClientRect()
		const x = ( clientX - rect.left ) * ( VIEW.width / rect.width )
		const time = xMin + ( ( x - VIEW.left ) / plotWidth ) * xSpan

		let best = 0

		for ( let index = 1; index < series.length; index += 1 ) {
			if ( Math.abs( series[ index ].time - time ) < Math.abs( series[ best ].time - time ) ) {
				best = index
			}
		}

		return best
	}

	let focusIndex = series.length - 1

	svg.addEventListener( "pointermove", ( event ) => {
		focusIndex = nearestIndex( event.clientX )
		showPoint( focusIndex )
	} )

	svg.addEventListener( "pointerleave", hide )
	svg.addEventListener( "blur", hide )

	// Keyboard reaches the same values as hover.
	svg.addEventListener( "keydown", ( event ) => {
		if ( "ArrowRight" === event.key || "ArrowLeft" === event.key ) {
			event.preventDefault()
			focusIndex = Math.min( Math.max( focusIndex + ( "ArrowRight" === event.key ? 1 : -1 ), 0 ), series.length - 1 )
			showPoint( focusIndex )
		}

		if ( "Escape" === event.key ) {
			hide()
		}
	} )

	wrap.append( svg, tooltip )
	container.append( wrap )
}
