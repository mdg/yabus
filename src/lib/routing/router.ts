import type { Position } from '#lib/geo/types.ts';

/** Turns a path's waypoints into the line the bus follows. */
export interface Router {
	/** Returns the path as a list of positions, starting at the first waypoint. */
	route(waypoints: Position[]): Promise<Position[]>;
}

/** Straight segments between waypoints. The fallback when no routing engine is available. */
export class StraightLineRouter implements Router {
	async route(waypoints: Position[]): Promise<Position[]> {
		return waypoints.map((p): Position => [p[0], p[1]]);
	}
}
