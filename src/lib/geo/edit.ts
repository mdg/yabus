import type { Router } from '#lib/routing/router.ts';
import { closeLoop, isClosed, openLoop } from './loop.ts';
import type { PathFeature, Position, RouteCollection, Waypoint } from './types.ts';

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

/**
 * Returns a copy of the route with one waypoint moved. The geometry is left as it was; rebuild
 * it afterwards. Keeps the route valid:
 * - on a closed loop, the first and closing waypoints are one point and move together;
 * - when a point-to-point route has two paths, moving an endpoint also moves the matching
 *   endpoint of the other path (path 0's start is path 1's end, and its end is path 1's
 *   start).
 * Unknown paths or waypoint ids leave the route unchanged.
 */
export function moveWaypoint(
	route: RouteCollection,
	pathIndex: number,
	waypointId: string,
	position: Position
): RouteCollection {
	const source = route.features[pathIndex];
	const index = source?.properties.waypoints.findIndex((w) => w.id === waypointId) ?? -1;
	if (!source || index < 0) return route;

	const coordinates: Position = [round6(position[0]), round6(position[1])];
	const count = source.properties.waypoints.length;
	// What to move, as [path index, waypoint index] pairs.
	const moves: [number, number][] = [[pathIndex, index]];

	if (
		source.properties.kind === 'loop' &&
		isClosed(source.properties.waypoints) &&
		(index === 0 || index === count - 1)
	) {
		moves.push([pathIndex, index === 0 ? count - 1 : 0]);
	}

	if (source.properties.kind === 'point-to-point' && route.features.length === 2 && count >= 2) {
		const otherIndex = pathIndex === 0 ? 1 : 0;
		const otherCount = route.features[otherIndex].properties.waypoints.length;
		if (otherCount >= 2) {
			if (index === 0) moves.push([otherIndex, otherCount - 1]);
			if (index === count - 1) moves.push([otherIndex, 0]);
		}
	}

	return {
		...route,
		features: route.features.map((f, i) => {
			const targets = moves.filter(([p]) => p === i).map(([, w]) => w);
			if (targets.length === 0) return f;
			return {
				...f,
				properties: {
					...f.properties,
					waypoints: f.properties.waypoints.map((w, wi) =>
						targets.includes(wi) ? { ...w, coordinates } : w
					)
				}
			};
		})
	};
}

/** Positions in a local flat frame (x scaled by cos(latitude)), good enough at city scale. */
function flat(p: Position, cosLat: number): [number, number] {
	return [p[0] * cosLat, p[1]];
}

/** The closest point on a polyline to `pos`: which segment, where on it, and how far away. */
function nearestOnLine(coords: Position[], pos: Position) {
	const cosLat = Math.cos((pos[1] * Math.PI) / 180);
	const [px, py] = flat(pos, cosLat);
	let best = { segment: 0, point: coords[0], dist: Infinity };
	for (let k = 0; k < coords.length - 1; k++) {
		const [ax, ay] = flat(coords[k], cosLat);
		const [bx, by] = flat(coords[k + 1], cosLat);
		const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
		const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
		const dist = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
		if (dist < best.dist) {
			const a = coords[k];
			const b = coords[k + 1];
			best = { segment: k, point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], dist };
		}
	}
	return best;
}

/**
 * Where each waypoint sits along the path's line, as an index into the line's positions. The
 * line is whatever the router returned, so it has no record of this; it is worked out by
 * walking forward and matching each waypoint to its nearest line position. The first waypoint
 * is the start of the line and the last is the end.
 */
function waypointLineIndexes(feature: PathFeature): number[] {
	const coords = feature.geometry.coordinates;
	const waypoints = feature.properties.waypoints;
	const last = coords.length - 1;
	const out: number[] = [];
	let from = 0;
	waypoints.forEach((w, i) => {
		if (i === 0) return void out.push(0);
		if (i === waypoints.length - 1) return void out.push(last);
		const cosLat = Math.cos((w.coordinates[1] * Math.PI) / 180);
		const [wx, wy] = flat(w.coordinates, cosLat);
		let bestIndex = from;
		let bestDist = Infinity;
		for (let j = from; j <= last; j++) {
			const [x, y] = flat(coords[j], cosLat);
			const d = (x - wx) ** 2 + (y - wy) ** 2;
			if (d < bestDist) {
				bestDist = d;
				bestIndex = j;
			}
		}
		out.push(bestIndex);
		from = bestIndex;
	});
	return out;
}

/**
 * Inserts a waypoint into the path whose line passes closest to `position`, among the
 * `candidatePaths` (the paths the user clicked on). The new waypoint goes on the line at the
 * closest point, between the two waypoints that surround that spot, so inserting it does not
 * change the shape of the route until it is dragged. Returns null when none of the candidates
 * has a line to insert into.
 *
 * Inserted waypoints are always interior, so loop closing and endpoints are never affected.
 * The geometry is left as it was; rebuild it afterwards.
 */
export function insertWaypointOnRoute(
	route: RouteCollection,
	position: Position,
	candidatePaths: number[]
): { route: RouteCollection; path: number; waypointId: string } | null {
	let best: { path: number; segment: number; point: Position; dist: number } | null = null;
	for (const path of candidatePaths) {
		const f = route.features[path];
		if (!f || f.geometry.coordinates.length < 2 || f.properties.waypoints.length < 2) continue;
		const hit = nearestOnLine(f.geometry.coordinates, position);
		if (!best || hit.dist < best.dist) best = { path, ...hit };
	}
	if (!best) return null;

	const feature = route.features[best.path];
	// Waypoints on or before the hit segment stay in front of the new one.
	const insertAt = waypointLineIndexes(feature).filter((i) => i <= best.segment).length;
	const waypoint: Waypoint = {
		id: crypto.randomUUID(),
		coordinates: [round6(best.point[0]), round6(best.point[1])]
	};
	const waypoints = [...feature.properties.waypoints];
	waypoints.splice(insertAt, 0, waypoint);

	return {
		route: {
			...route,
			features: route.features.map((f, i) =>
				i === best.path ? { ...f, properties: { ...f.properties, waypoints } } : f
			)
		},
		path: best.path,
		waypointId: waypoint.id
	};
}

/**
 * Whether a waypoint may be deleted. When a point-to-point route has a return path, the two
 * paths share their endpoints, so a path's first and last waypoint cannot be deleted. Interior
 * waypoints can always be deleted, and so can anything on a single-path route.
 */
export function canDeleteWaypoint(route: RouteCollection, pathIndex: number, waypointId: string): boolean {
	const f = route.features[pathIndex];
	if (!f) return false;
	const waypoints = f.properties.waypoints;
	const index = waypoints.findIndex((w) => w.id === waypointId);
	if (index < 0) return false;
	const isEndpoint = index === 0 || index === waypoints.length - 1;
	return !(f.properties.kind === 'point-to-point' && route.features.length === 2 && isEndpoint);
}

/**
 * Returns a copy of the route without the waypoint (unchanged if it cannot be deleted). On a
 * loop, deleting the start, or its closing twin, makes the next waypoint the new start and
 * closes the loop again. The geometry is left as it was; rebuild it afterwards.
 */
export function deleteWaypoint(
	route: RouteCollection,
	pathIndex: number,
	waypointId: string
): RouteCollection {
	if (!canDeleteWaypoint(route, pathIndex, waypointId)) return route;
	const feature = route.features[pathIndex];
	const current = feature.properties.waypoints;
	const index = current.findIndex((w) => w.id === waypointId);

	let waypoints: Waypoint[];
	if (feature.properties.kind === 'loop') {
		// The closing waypoint is the start's twin, so deleting either removes the start.
		const target = isClosed(current) && index === current.length - 1 ? 0 : index;
		waypoints = closeLoop(openLoop(current).filter((_, i) => i !== target));
	} else {
		waypoints = current.filter((_, i) => i !== index);
	}

	return {
		...route,
		features: route.features.map((f, i) =>
			i === pathIndex ? { ...f, properties: { ...f.properties, waypoints } } : f
		)
	};
}
