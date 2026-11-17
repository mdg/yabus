import type { RouteCollection } from '#lib/geo/types.ts';

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

/** One line per path that has a drawable line (2+ positions). */
export function pathLines(route: RouteCollection | null): MapFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: (route?.features ?? [])
			.filter((f) => f.geometry.coordinates.length >= 2)
			.map((f) => ({
				type: 'Feature',
				geometry: f.geometry,
				properties: {
					color: f.properties.color,
					number: f.properties.number,
					direction: f.properties.direction
				}
			}))
	};
}

/** One point per waypoint. The first and last waypoint of a path are flagged as endpoints. */
export function waypointPoints(route: RouteCollection | null): MapFeatureCollection {
	const features: MapFeatureCollection['features'] = [];
	for (const f of route?.features ?? []) {
		const { waypoints, color } = f.properties;
		waypoints.forEach((w, index) => {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: w.coordinates },
				properties: {
					id: w.id,
					color,
					index,
					endpoint: index === 0 || index === waypoints.length - 1
				}
			});
		});
	}
	return { type: 'FeatureCollection', features };
}
