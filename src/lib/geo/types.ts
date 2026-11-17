export type Position = [lng: number, lat: number];

export type RouteKind = 'loop' | 'point-to-point';

export interface Waypoint {
	id: string;
	coordinates: Position;
	name?: string;
}

export interface PathProperties {
	kind: RouteKind;
	/** 0 = primary (A to B), 1 = return (B to A). Always 0 for loops. */
	direction: 0 | 1;
	/** Route number. Identifies the route within a user's collection. */
	number: string;
	name: string;
	color: string;
	waypoints: Waypoint[];
}

/** One path of a route: a single line of travel in one direction. */
export interface PathFeature {
	type: 'Feature';
	id: string;
	geometry: { type: 'LineString'; coordinates: Position[] };
	properties: PathProperties;
}

/** A route: one or two paths. */
export interface RouteCollection {
	type: 'FeatureCollection';
	features: PathFeature[];
}
