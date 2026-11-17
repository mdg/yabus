import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { RouteCollection } from '#lib/geo/types.ts';
import { pathLines, waypointPoints } from './routeData.ts';

const LINES = 'route-lines';
const WAYPOINTS = 'route-waypoints';

const empty = { type: 'FeatureCollection', features: [] } as const;

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
	map.addLayer({
		id: WAYPOINTS,
		type: 'circle',
		source: WAYPOINTS,
		paint: {
			'circle-radius': ['case', ['get', 'endpoint'], 7, 5],
			'circle-color': '#ffffff',
			'circle-stroke-color': ['get', 'color'],
			'circle-stroke-width': 3
		}
	});
}

/** Replaces what the route layers show. Pass null to clear. */
export function setRouteData(map: MapLibreMap, route: RouteCollection | null): void {
	(map.getSource(LINES) as GeoJSONSource | undefined)?.setData(pathLines(route));
	(map.getSource(WAYPOINTS) as GeoJSONSource | undefined)?.setData(waypointPoints(route));
}
