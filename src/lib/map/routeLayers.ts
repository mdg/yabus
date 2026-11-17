import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { contrastColor } from '#lib/geo/color.ts';
import type { RouteCollection, WaypointRef } from '#lib/geo/types.ts';
import { pathLines, waypointPoints } from './routeData.ts';

const LINES = 'route-lines';
const WAYPOINTS = 'route-waypoints';

/** The waypoint markers. Edit-view interactions (hover, drag, select) target this layer. */
export const WAYPOINT_LAYER = WAYPOINTS;

/** The colored route line. Clicking it inserts a waypoint. */
export const LINE_LAYER = LINES;

const empty = { type: 'FeatureCollection', features: [] } as const;

const arrowId = (color: string) => `route-arrow-${color}`;

/** A small chevron pointing right: a contrasting center stroke inside a route-colored outline. */
function arrowImage(color: string): ImageData {
	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(10, 7);
	ctx.lineTo(22, 16);
	ctx.lineTo(10, 25);
	ctx.strokeStyle = color;
	ctx.lineWidth = 8;
	ctx.stroke();
	ctx.strokeStyle = contrastColor(color);
	ctx.lineWidth = 4;
	ctx.stroke();
	return ctx.getImageData(0, 0, size, size);
}

/** Arrow images are per color, because routes can be any color. Add any that are missing. */
function ensureArrowImages(map: MapLibreMap, route: RouteCollection | null): void {
	for (const f of route?.features ?? []) {
		const id = arrowId(f.properties.color);
		if (!map.hasImage(id)) map.addImage(id, arrowImage(f.properties.color), { pixelRatio: 2 });
	}
}

/** Adds the sources and layers that draw routes. Call once the style has loaded. */
export function addRouteLayers(map: MapLibreMap): void {
	map.addSource(LINES, { type: 'geojson', data: empty });
	map.addSource(WAYPOINTS, { type: 'geojson', data: empty });

	// White casing under the colored line keeps it readable on any basemap.
	map.addLayer({
		id: `${LINES}-casing`,
		type: 'line',
		source: LINES,
		layout: { 'line-join': 'round', 'line-cap': 'round' },
		paint: {
			'line-color': '#ffffff',
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 11]
		}
	});
	map.addLayer({
		id: LINES,
		type: 'line',
		source: LINES,
		layout: { 'line-join': 'round', 'line-cap': 'round' },
		paint: {
			'line-color': ['get', 'color'],
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7]
		}
	});

	// Direction of travel. Each path has its own arrows, pointing along the path. Arrows always
	// draw, even where they would collide with other symbols.
	map.addLayer({
		id: `${LINES}-arrows`,
		type: 'symbol',
		source: LINES,
		layout: {
			'symbol-placement': 'line',
			'symbol-spacing': 90,
			'icon-image': ['concat', 'route-arrow-', ['get', 'color']],
			'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 1.2],
			'icon-rotation-alignment': 'map',
			'icon-allow-overlap': true,
			'icon-ignore-placement': true
		}
	});

	// The route number, repeated along the line.
	map.addLayer({
		id: `${LINES}-labels`,
		type: 'symbol',
		source: LINES,
		layout: {
			'symbol-placement': 'line',
			'symbol-spacing': 320,
			'text-field': ['get', 'number'],
			'text-font': ['Noto Sans Bold'],
			'text-size': ['interpolate', ['linear'], ['zoom'], 10, 13, 16, 17],
			'text-keep-upright': true,
			'text-padding': 4
		},
		paint: {
			'text-color': ['get', 'textColor'],
			'text-halo-color': ['get', 'color'],
			'text-halo-width': 2.5
		}
	});

	map.addLayer({
		id: WAYPOINTS,
		type: 'circle',
		source: WAYPOINTS,
		paint: {
			'circle-radius': [
				'+',
				['case', ['get', 'endpoint'], 8, 6],
				['case', ['get', 'selected'], 3, 0]
			],
			// The selected waypoint is filled yellow so it stands out.
			'circle-color': ['case', ['get', 'selected'], '#ffd60a', '#ffffff'],
			'circle-stroke-color': ['get', 'color'],
			'circle-stroke-width': 3
		}
	});
}

/** Replaces what the route layers show. Pass a null route to clear. */
export function setRouteData(
	map: MapLibreMap,
	route: RouteCollection | null,
	selected: WaypointRef | null = null
): void {
	ensureArrowImages(map, route);
	(map.getSource(LINES) as GeoJSONSource | undefined)?.setData(pathLines(route));
	(map.getSource(WAYPOINTS) as GeoJSONSource | undefined)?.setData(waypointPoints(route, selected));
}
