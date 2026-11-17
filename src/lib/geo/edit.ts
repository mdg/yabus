import type { Router } from '#lib/routing/router.ts';
import { closeLoop, openLoop } from './loop.ts';
import type { PathFeature, Position, RouteCollection } from './types.ts';

/** About 0.1 m. Keeps stored coordinates tidy. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Returns a copy of the route with a waypoint added to the given path. The path's geometry is
 * left as it was; call `deriveGeometry` afterwards to rebuild it.
 *
 * On a loop the new waypoint goes before the closing waypoint, and the loop is closed again
 * automatically.
 */
export function appendWaypoint(
	route: RouteCollection,
	position: Position,
	pathIndex = 0
): RouteCollection {
	return {
		...route,
		features: route.features.map((f, i) => {
			if (i !== pathIndex) return f;
			const added = {
				id: crypto.randomUUID(),
				coordinates: [round6(position[0]), round6(position[1])] as Position
			};
			const isLoop = f.properties.kind === 'loop';
			const base = isLoop ? openLoop(f.properties.waypoints) : f.properties.waypoints;
			const waypoints = [...base, added];
			return {
				...f,
				properties: { ...f.properties, waypoints: isLoop ? closeLoop(waypoints) : waypoints }
			};
		})
	};
}

const waypointPositions = (f: PathFeature): Position[] =>
	f.properties.waypoints.map((w) => w.coordinates);

function withCoordinates(f: PathFeature, coordinates: Position[]): PathFeature {
	return { ...f, geometry: { type: 'LineString', coordinates } };
}

/** Rebuilds every path's line from its waypoints using the router. Needs 2+ waypoints per path. */
export async function deriveGeometry(
	route: RouteCollection,
	router: Router
): Promise<RouteCollection> {
	const features = await Promise.all(
		route.features.map(async (f) => {
			const waypoints = waypointPositions(f);
			return withCoordinates(f, waypoints.length >= 2 ? await router.route(waypoints) : []);
		})
	);
	return { ...route, features };
}

/** Synchronous fallback: straight segments between waypoints. */
export function straightGeometry(route: RouteCollection): RouteCollection {
	return {
		...route,
		features: route.features.map((f) => {
			const waypoints = waypointPositions(f);
			return withCoordinates(f, waypoints.length >= 2 ? waypoints : []);
		})
	};
}

/**
 * Puts the geometry from `derived` onto `current`, matching paths by id, and keeps everything
 * else in `current`. Used when an async rebuild finishes after other edits (a new name, a new
 * color) happened, so those edits are not overwritten by the older snapshot.
 */
export function mergeGeometry(current: RouteCollection, derived: RouteCollection): RouteCollection {
	return {
		...current,
		features: current.features.map((f) => {
			const match = derived.features.find((d) => d.id === f.id);
			return match ? { ...f, geometry: match.geometry } : f;
		})
	};
}
