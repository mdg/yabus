import type { RouteCollection } from './types.ts';

/** A route in the composite view, and where it came from. */
export interface CompositeEntry {
	route: RouteCollection;
	/** `local`: in this browser's localStorage, so editable. `server`: only on the server, so read-only. */
	source: 'local' | 'server';
}

const numberOf = (r: RouteCollection) => r.features[0].properties.number;

/**
 * Combines a user's routes from `localStorage` and from the server, sorted by route number
 * (2 before 10). `localStorage` wins: when a number exists in both, the local copy is shown
 * and the server copy is dropped. Routes only on the server are read-only.
 */
export function mergeComposite(local: RouteCollection[], server: RouteCollection[]): CompositeEntry[] {
	const localNumbers = new Set(local.map((r) => numberOf(r).toLowerCase()));
	const entries: CompositeEntry[] = [
		...local.map((route): CompositeEntry => ({ route, source: 'local' })),
		...server
			.filter((r) => !localNumbers.has(numberOf(r).toLowerCase()))
			.map((route): CompositeEntry => ({ route, source: 'server' }))
	];
	return entries.sort((a, b) =>
		numberOf(a.route).localeCompare(numberOf(b.route), undefined, { numeric: true })
	);
}

export interface Bounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

/**
 * The box around every route, for fitting the map. Uses each path's line, or its waypoints when
 * it has no line yet. Null when there is nothing to show.
 */
export function compositeBounds(routes: RouteCollection[]): Bounds | null {
	let bounds: Bounds | null = null;
	const extend = ([lng, lat]: [number, number]) => {
		bounds = bounds
			? {
					west: Math.min(bounds.west, lng),
					south: Math.min(bounds.south, lat),
					east: Math.max(bounds.east, lng),
					north: Math.max(bounds.north, lat)
				}
			: { west: lng, south: lat, east: lng, north: lat };
	};
	for (const route of routes) {
		for (const f of route.features) {
			const points =
				f.geometry.coordinates.length > 0
					? f.geometry.coordinates
					: f.properties.waypoints.map((w) => w.coordinates);
			points.forEach(extend);
		}
	}
	return bounds;
}
