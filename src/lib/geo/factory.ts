import type { RouteCollection } from './types.ts';

export const DEFAULT_ROUTE_COLOR = '#e63946';

/** A new, empty one-direction point-to-point route. */
export function newRoute(number: string): RouteCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: crypto.randomUUID(),
				geometry: { type: 'LineString', coordinates: [] },
				properties: {
					kind: 'point-to-point',
					direction: 0,
					number,
					name: `Route ${number}`,
					color: DEFAULT_ROUTE_COLOR,
					waypoints: []
				}
			}
		]
	};
}
