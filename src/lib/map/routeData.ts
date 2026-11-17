import { contrastColor } from '#lib/geo/color.ts';
import { isClosed } from '#lib/geo/loop.ts';
import type { RouteCollection, WaypointRef } from '#lib/geo/types.ts';

/** Minimal GeoJSON shapes for the map sources (no MapLibre import, so this is easy to test). */
export interface MapFeatureCollection {
	type: 'FeatureCollection';
	features: {
		type: 'Feature';
		geometry:
			| { type: 'LineString'; coordinates: [number, number][] }
			| { type: 'Point'; coordinates: [number, number] };
		properties: Record<string, string | number | boolean>;
	}[];
}

type RoutesInput = RouteCollection | RouteCollection[] | null;
const asList = (routes: RoutesInput): RouteCollection[] =>
	routes === null ? [] : Array.isArray(routes) ? routes : [routes];

/**
 * One line per path that has a drawable line (2+ positions), for one route or several.
 * `path` is the path's index within its route.
 */
export function pathLines(routes: RoutesInput): MapFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: asList(routes).flatMap((route) =>
			route.features
				.map((f, path) => ({ f, path }))
				.filter(({ f }) => f.geometry.coordinates.length >= 2)
				.map(({ f, path }) => ({
					type: 'Feature' as const,
					geometry: f.geometry,
					properties: {
						path,
						color: f.properties.color,
						textColor: contrastColor(f.properties.color),
						number: f.properties.number,
						direction: f.properties.direction
					}
				}))
		)
	};
}

/**
 * One point per waypoint. `path` is the index of the path it belongs to. The first and last
 * waypoint of a path are flagged as endpoints, and the selected waypoint is flagged too.
 */
export function waypointPoints(
	route: RouteCollection | null,
	selected: WaypointRef | null = null
): MapFeatureCollection {
	const features: MapFeatureCollection['features'] = [];
	(route?.features ?? []).forEach((f, path) => {
		const { waypoints, color } = f.properties;
		// A loop's closing waypoint is its start's twin, so selecting one selects both.
		const closing = f.properties.kind === 'loop' && isClosed(waypoints);
		waypoints.forEach((w, index) => {
			const isSelected =
				selected?.path === path &&
				(w.id === selected.id || (closing && index === waypoints.length - 1 && waypoints[0].id === selected.id));
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: w.coordinates },
				properties: {
					id: w.id,
					path,
					color,
					index,
					endpoint: index === 0 || index === waypoints.length - 1,
					selected: isSelected
				}
			});
		});
	});
	return { type: 'FeatureCollection', features };
}

/** Only the endpoint markers (path starts and ends), for one route or several. */
export function endpointPoints(routes: RoutesInput): MapFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: asList(routes).flatMap(
			(route) => waypointPoints(route).features.filter((f) => f.properties.endpoint)
		)
	};
}
