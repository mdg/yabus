import type { Position, RouteCollection } from './types.ts';

/**
 * A copy of a route under a new number, with new ids for every path and waypoint and nothing
 * shared with the original. The copy keeps the original's kind, color, paths and lines. A name
 * that was just the default for the old number (`Route 3`) becomes the default for the new one.
 */
export function duplicateRoute(route: RouteCollection, number: string): RouteCollection {
	const { number: oldNumber, name: oldName } = route.features[0].properties;
	const name = oldName === `Route ${oldNumber}` ? `Route ${number}` : oldName;

	return {
		type: 'FeatureCollection',
		features: route.features.map((f) => ({
			type: 'Feature',
			id: crypto.randomUUID(),
			geometry: {
				type: 'LineString',
				coordinates: f.geometry.coordinates.map(([lng, lat]): Position => [lng, lat])
			},
			properties: {
				...f.properties,
				number,
				name,
				waypoints: f.properties.waypoints.map((w) => ({
					...w,
					id: crypto.randomUUID(),
					coordinates: [w.coordinates[0], w.coordinates[1]] as Position
				}))
			}
		}))
	};
}
