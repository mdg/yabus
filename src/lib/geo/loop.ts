import type { Position, Waypoint } from './types.ts';

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** A loop path is closed when it has 2+ waypoints and the last sits on the first. */
export function isClosed(waypoints: Waypoint[]): boolean {
	return (
		waypoints.length >= 2 &&
		same(waypoints[0].coordinates, waypoints[waypoints.length - 1].coordinates)
	);
}

/** Drops the closing waypoint, if there is one. */
export function openLoop(waypoints: Waypoint[]): Waypoint[] {
	return isClosed(waypoints) ? waypoints.slice(0, -1) : waypoints;
}

/** Adds a closing waypoint on top of the first one. A single waypoint has nothing to close. */
export function closeLoop(waypoints: Waypoint[]): Waypoint[] {
	if (waypoints.length < 2 || isClosed(waypoints)) return waypoints;
	const [lng, lat] = waypoints[0].coordinates;
	return [...waypoints, { id: crypto.randomUUID(), coordinates: [lng, lat] }];
}
