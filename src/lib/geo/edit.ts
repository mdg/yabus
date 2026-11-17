import type { Router } from '#lib/routing/router.ts';
import type { PathFeature, Position, RouteCollection } from './types.ts';

/** About 0.1 m. Keeps stored coordinates tidy. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Returns a copy of the route with a waypoint appended to the given path. The path's geometry
 * is left as it was; call `deriveGeometry` afterwards to rebuild it.
 */
export function appendWaypoint(
	route: RouteCollection,
	position: Position,
	pathIndex = 0
): RouteCollection {
	return {
		...route,
		features: route.features.map((f, i) =>
			i !== pathIndex
				? f
				: {
						...f,
						properties: {
							...f.properties,
							waypoints: [
								...f.properties.waypoints,
								{
									id: crypto.randomUUID(),
									coordinates: [round6(position[0]), round6(position[1])]
								}
							]
						}
					}
		)
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
