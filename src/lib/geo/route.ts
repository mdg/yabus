import type { PathFeature, Position, RouteCollection, Waypoint } from './types.ts';

/** File-name safe. Used for route numbers, usernames and the file names derived from them. */
export const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const ROUTE_NUMBER_RE = SAFE_NAME_RE;
export const USERNAME_RE = SAFE_NAME_RE;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type ParseResult =
	| { ok: true; route: RouteCollection }
	| { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPosition(v: unknown): v is Position {
	return (
		Array.isArray(v) &&
		v.length === 2 &&
		typeof v[0] === 'number' &&
		typeof v[1] === 'number' &&
		Number.isFinite(v[0]) &&
		Number.isFinite(v[1]) &&
		Math.abs(v[0]) <= 180 &&
		Math.abs(v[1]) <= 90
	);
}

function samePosition(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

/**
 * Validates untrusted data as a route: shape first, then the route invariants.
 *
 * In-progress routes are allowed (a path may have fewer than 2 waypoints while the user is
 * still drawing it). Invariants that compare endpoints are only checked once the paths have
 * waypoints to compare.
 *
 * If `expectedNumber` is given, the route's number must equal it.
 */
export function parseRoute(data: unknown, expectedNumber?: string): ParseResult {
	const errors: string[] = [];
	if (!isRecord(data) || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
		return { ok: false, errors: ['must be a GeoJSON FeatureCollection'] };
	}
	const rawFeatures = data.features;
	if (rawFeatures.length < 1 || rawFeatures.length > 2) {
		return { ok: false, errors: ['a route has 1 or 2 paths'] };
	}

	const features: PathFeature[] = [];
	rawFeatures.forEach((f, i) => {
		const at = `features[${i}]`;
		if (!isRecord(f) || f.type !== 'Feature' || typeof f.id !== 'string' || !f.id) {
			errors.push(`${at}: must be a Feature with a string id`);
			return;
		}
		const g = f.geometry;
		if (
			!isRecord(g) ||
			g.type !== 'LineString' ||
			!Array.isArray(g.coordinates) ||
			!g.coordinates.every(isPosition)
		) {
			errors.push(`${at}: geometry must be a LineString of [lng, lat] positions`);
			return;
		}
		const p = f.properties;
		if (!isRecord(p)) {
			errors.push(`${at}: missing properties`);
			return;
		}
		if (p.kind !== 'loop' && p.kind !== 'point-to-point') {
			errors.push(`${at}: kind must be "loop" or "point-to-point"`);
			return;
		}
		if (p.direction !== 0 && p.direction !== 1) {
			errors.push(`${at}: direction must be 0 or 1`);
			return;
		}
		if (typeof p.number !== 'string' || !ROUTE_NUMBER_RE.test(p.number)) {
			errors.push(`${at}: number is not a valid route number`);
			return;
		}
		if (typeof p.name !== 'string' || p.name.length > 200) {
			errors.push(`${at}: name must be a string of at most 200 characters`);
			return;
		}
		if (typeof p.color !== 'string' || !COLOR_RE.test(p.color)) {
			errors.push(`${at}: color must look like #rrggbb`);
			return;
		}
		if (!Array.isArray(p.waypoints) || p.waypoints.length > 500) {
			errors.push(`${at}: waypoints must be an array of at most 500 items`);
			return;
		}
		const waypoints: Waypoint[] = [];
		for (const w of p.waypoints) {
			if (
				!isRecord(w) ||
				typeof w.id !== 'string' ||
				!isPosition(w.coordinates) ||
				(w.name !== undefined && typeof w.name !== 'string')
			) {
				errors.push(`${at}: each waypoint needs a string id and [lng, lat] coordinates`);
				return;
			}
			waypoints.push({
				id: w.id,
				coordinates: w.coordinates,
				...(w.name !== undefined ? { name: w.name } : {})
			});
		}
		features.push({
			type: 'Feature',
			id: f.id,
			geometry: { type: 'LineString', coordinates: g.coordinates as Position[] },
			properties: {
				kind: p.kind,
				direction: p.direction,
				number: p.number,
				name: p.name,
				color: p.color,
				waypoints
			}
		});
	});
	if (errors.length > 0) return { ok: false, errors };

	// Route-level fields are duplicated on every path and must agree.
	const first = features[0].properties;
	for (const f of features) {
		const p = f.properties;
		if (
			p.kind !== first.kind ||
			p.number !== first.number ||
			p.name !== first.name ||
			p.color !== first.color
		) {
			errors.push('kind, number, name and color must be the same on every path');
			break;
		}
	}
	if (expectedNumber !== undefined && first.number !== expectedNumber) {
		errors.push('route number does not match the requested route');
	}
	if (errors.length > 0) return { ok: false, errors };

	// Invariants 1 to 3.
	if (first.kind === 'loop') {
		if (features.length !== 1) errors.push('a loop has exactly 1 path');
		const f = features[0];
		if (f.properties.direction !== 0) errors.push('a loop path has direction 0');
		const w = f.properties.waypoints;
		if (w.length >= 2 && !samePosition(w[0].coordinates, w[w.length - 1].coordinates)) {
			errors.push('a loop must start and end at the same point');
		}
	} else if (features.length === 2) {
		const a = features.find((f) => f.properties.direction === 0);
		const b = features.find((f) => f.properties.direction === 1);
		if (!a || !b) {
			errors.push('a two-path route needs one path with direction 0 and one with direction 1');
		} else {
			const aw = a.properties.waypoints;
			const bw = b.properties.waypoints;
			if (aw.length >= 2 && bw.length >= 2) {
				if (!samePosition(aw[0].coordinates, bw[bw.length - 1].coordinates)) {
					errors.push('the return path must end where the primary path starts');
				}
				if (!samePosition(aw[aw.length - 1].coordinates, bw[0].coordinates)) {
					errors.push('the return path must start where the primary path ends');
				}
			}
		}
	} else if (features[0].properties.direction !== 0) {
		errors.push('a single path has direction 0');
	}
	if (errors.length > 0) return { ok: false, errors };

	return { ok: true, route: { type: 'FeatureCollection', features } };
}

/** The route-level fields, taken from the first path. */
export function routeSummary(route: RouteCollection) {
	const p = route.features[0].properties;
	return { number: p.number, name: p.name, color: p.color, kind: p.kind, paths: route.features.length };
}
