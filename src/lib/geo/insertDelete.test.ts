import { describe, expect, test } from 'bun:test';
import { waypointPoints, pathLines } from '#lib/map/routeData.ts';
import {
	appendWaypoint,
	canDeleteWaypoint,
	deleteWaypoint,
	insertWaypointOnRoute,
	straightGeometry
} from './edit.ts';
import { newRoute } from './factory.ts';
import { isClosed } from './loop.ts';
import { applyMetadata } from './meta.ts';
import { parseRoute } from './route.ts';
import type { Position, RouteCollection } from './types.ts';

// Four points on a roughly east-west line, so "near the line" is easy to express.
const A: Position = [-74.1, 40.7];
const B: Position = [-74.0, 40.7];
const C: Position = [-73.9, 40.7];
const D: Position = [-73.9, 40.8];

const draw = (...points: Position[]) => {
	let r = newRoute('1');
	for (const p of points) r = appendWaypoint(r, p);
	return straightGeometry(r);
};
const coords = (r: RouteCollection, p = 0) => r.features[p].properties.waypoints.map((w) => w.coordinates);
const ids = (r: RouteCollection, p = 0) => r.features[p].properties.waypoints.map((w) => w.id);

/** A second, return path B to A through X, sharing the endpoints. */
function withReturnPath(route: RouteCollection, via: Position): RouteCollection {
	const [first, ...rest] = route.features;
	const w = first.properties.waypoints;
	const ret = straightGeometry({
		...route,
		features: [
			{
				...first,
				id: 'return',
				properties: {
					...first.properties,
					direction: 1,
					waypoints: [
						{ id: 'r0', coordinates: w[w.length - 1].coordinates },
						{ id: 'r1', coordinates: via },
						{ id: 'r2', coordinates: w[0].coordinates }
					]
				}
			}
		]
	}).features[0];
	return { ...route, features: [first, ret, ...rest] };
}

describe('insertWaypointOnRoute', () => {
	test('inserts on the line between the right pair of waypoints', () => {
		const r = draw(A, B, C);
		// just north of the B-C segment
		const out = insertWaypointOnRoute(r, [-73.95, 40.7003], [0])!;
		expect(coords(out.route)).toHaveLength(4);
		expect(coords(out.route)[0]).toEqual(A);
		expect(coords(out.route)[1]).toEqual(B);
		expect(coords(out.route)[3]).toEqual(C);
		// the new waypoint sits ON the line, not where the pointer was
		expect(coords(out.route)[2][1]).toBe(40.7);
		expect(out.waypointId).toBe(ids(out.route)[2]);
		expect(parseRoute(out.route).ok).toBe(true);
	});

	test('inserts in the first segment too, and does not mutate the original', () => {
		const r = draw(A, B, C);
		const out = insertWaypointOnRoute(r, [-74.05, 40.7], [0])!;
		expect(coords(out.route)[1][0]).toBe(-74.05);
		expect(coords(out.route)[2]).toEqual(B);
		expect(coords(r)).toHaveLength(3);
	});

	test('works with a routed line that has many more positions than waypoints', () => {
		const r = draw(A, B, C);
		// the routed line wiggles through extra positions between the waypoints
		const wiggly: Position[] = [A, [-74.07, 40.702], [-74.04, 40.702], B, [-73.97, 40.698], [-73.93, 40.698], C];
		const routed: RouteCollection = {
			...r,
			features: [{ ...r.features[0], geometry: { type: 'LineString', coordinates: wiggly } }]
		};
		// click near the extra position between B and C
		const out = insertWaypointOnRoute(routed, [-73.93, 40.6985], [0])!;
		expect(coords(out.route)).toHaveLength(4);
		expect(coords(out.route)[1]).toEqual(B);
		expect(coords(out.route)[3]).toEqual(C);
		// and near the extra position between A and B
		const first = insertWaypointOnRoute(routed, [-74.07, 40.7021], [0])!;
		expect(coords(first.route)[0]).toEqual(A);
		expect(coords(first.route)[2]).toEqual(B);
	});

	test('inserting into a loop never touches the closing waypoint', () => {
		const loop = straightGeometry(applyMetadata(draw(A, B, D), { kind: 'loop' })); // A B D A
		// on the closing segment, D back to A
		const out = insertWaypointOnRoute(loop, [-74.0, 40.75], [0])!;
		const w = coords(out.route);
		expect(w).toHaveLength(5);
		expect(w[0]).toEqual(A);
		expect(w[4]).toEqual(A);
		expect(isClosed(out.route.features[0].properties.waypoints)).toBe(true);
		expect(parseRoute(out.route).ok).toBe(true);
	});

	test('picks the nearest of several candidate paths and leaves the other alone', () => {
		const base = draw(A, C);
		const route: RouteCollection = withReturnPath(base, [-74.0, 40.69]); // return path dips south
		const north = insertWaypointOnRoute(route, [-74.0, 40.7], [0, 1])!;
		expect(north.path).toBe(0);
		const south = insertWaypointOnRoute(route, [-74.0, 40.6901], [0, 1])!;
		expect(south.path).toBe(1);
		expect(coords(south.route, 0)).toEqual(coords(route, 0));
		expect(parseRoute(south.route).ok).toBe(true);
	});

	test('returns null with no line to insert into', () => {
		expect(insertWaypointOnRoute(draw(A), [-74.1, 40.7], [0])).toBeNull();
		expect(insertWaypointOnRoute(draw(A, B), [-74.05, 40.7], [])).toBeNull();
		expect(insertWaypointOnRoute(draw(A, B), [-74.05, 40.7], [3])).toBeNull();
	});
});

describe('deleteWaypoint', () => {
	test('removes an interior waypoint', () => {
		const r = draw(A, B, C);
		const out = deleteWaypoint(r, 0, ids(r)[1]);
		expect(coords(out)).toEqual([A, C]);
		expect(coords(r)).toHaveLength(3); // original untouched
	});

	test('on a single-path route the endpoints can be deleted', () => {
		const r = draw(A, B, C);
		expect(coords(deleteWaypoint(r, 0, ids(r)[0]))).toEqual([B, C]);
		expect(coords(deleteWaypoint(r, 0, ids(r)[2]))).toEqual([A, B]);
		expect(parseRoute(deleteWaypoint(r, 0, ids(r)[0])).ok).toBe(true);
	});

	test('can delete down to nothing', () => {
		let r = draw(A);
		r = deleteWaypoint(r, 0, ids(r)[0]);
		expect(coords(r)).toEqual([]);
		expect(parseRoute(r).ok).toBe(true);
	});

	test('on a loop, deleting an interior waypoint keeps it closed', () => {
		const loop = applyMetadata(draw(A, B, C, D), { kind: 'loop' }); // A B C D A
		const out = deleteWaypoint(loop, 0, ids(loop)[2]);
		expect(coords(out)).toEqual([A, B, D, A]);
		expect(parseRoute(out).ok).toBe(true);
	});

	test('on a loop, deleting the start or its closing twin makes the next waypoint the start', () => {
		const loop = applyMetadata(draw(A, B, C, D), { kind: 'loop' }); // A B C D A
		const viaStart = deleteWaypoint(loop, 0, ids(loop)[0]);
		expect(coords(viaStart)).toEqual([B, C, D, B]);
		const viaClosing = deleteWaypoint(loop, 0, ids(loop)[4]);
		expect(coords(viaClosing)).toEqual([B, C, D, B]);
		expect(parseRoute(viaStart).ok).toBe(true);
		expect(parseRoute(viaClosing).ok).toBe(true);
	});

	test('a loop shrinks gracefully', () => {
		let loop = applyMetadata(draw(A, B), { kind: 'loop' }); // A B A
		loop = deleteWaypoint(loop, 0, ids(loop)[1]); // leaves just A
		expect(coords(loop)).toEqual([A]);
		expect(parseRoute(loop).ok).toBe(true);
	});

	test('with a return path, endpoints cannot be deleted but interior waypoints can', () => {
		const route = withReturnPath(draw(A, B, C), [-74.0, 40.69]);
		const first = ids(route, 0);
		expect(canDeleteWaypoint(route, 0, first[0])).toBe(false);
		expect(canDeleteWaypoint(route, 0, first[2])).toBe(false);
		expect(canDeleteWaypoint(route, 1, 'r0')).toBe(false);
		expect(canDeleteWaypoint(route, 0, first[1])).toBe(true);
		expect(canDeleteWaypoint(route, 1, 'r1')).toBe(true);
		expect(deleteWaypoint(route, 0, first[0])).toBe(route); // refused: unchanged
		const out = deleteWaypoint(route, 1, 'r1');
		expect(coords(out, 1)).toEqual([C, A]);
		expect(parseRoute(out).ok).toBe(true);
	});

	test('unknown ids or paths change nothing', () => {
		const r = draw(A, B);
		expect(canDeleteWaypoint(r, 0, 'nope')).toBe(false);
		expect(canDeleteWaypoint(r, 4, ids(r)[0])).toBe(false);
		expect(deleteWaypoint(r, 0, 'nope')).toBe(r);
	});
});

describe('selection in map data', () => {
	test('flags only the selected waypoint', () => {
		const r = draw(A, B, C);
		const flags = waypointPoints(r, { path: 0, id: ids(r)[1] }).features.map((f) => f.properties.selected);
		expect(flags).toEqual([false, true, false]);
		expect(waypointPoints(r).features.every((f) => f.properties.selected === false)).toBe(true);
	});

	test('selecting a loop start also highlights its closing twin', () => {
		const loop = applyMetadata(draw(A, B, C), { kind: 'loop' }); // A B C A
		const flags = waypointPoints(loop, { path: 0, id: ids(loop)[0] }).features.map((f) => f.properties.selected);
		expect(flags).toEqual([true, false, false, true]);
	});

	test('lines know which path they belong to', () => {
		const route = withReturnPath(draw(A, C), [-74.0, 40.69]);
		expect(pathLines(route).features.map((f) => f.properties.path)).toEqual([0, 1]);
	});
});
