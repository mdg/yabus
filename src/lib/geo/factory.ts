import type { RouteCollection } from './types.ts';

/** Colors handed out to new routes in turn, so routes are easy to tell apart. */
export const ROUTE_COLORS = [
	'#e63946', // red
	'#1d70b8', // blue
	'#2a9d8f', // teal
	'#f4a261', // orange
	'#8e44ad', // purple
	'#6a994e', // green
	'#d6336c', // pink
	'#495057' // gray
] as const;

export const DEFAULT_ROUTE_COLOR = ROUTE_COLORS[0];

/** A new, empty one-direction point-to-point route. */
export function newRoute(number: string, color: string = DEFAULT_ROUTE_COLOR): RouteCollection {
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
					color,
					waypoints: []
				}
			}
		]
	};
}
