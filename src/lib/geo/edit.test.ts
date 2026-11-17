import { describe, expect, test } from 'bun:test';
import { StraightLineRouter, type Router } from '#lib/routing/router.ts';
import { pathLines, waypointPoints } from '#lib/map/routeData.ts';
import { appendWaypoint, deriveGeometry, moveWaypoint, straightGeometry } from './edit.ts';
import { newRoute } from './factory.ts';
import { applyMetadata } from './meta.ts';
import { parseRoute } from './route.ts';

describe('newRoute', () => {
	test('is a valid, empty, one-direction route', () => {
		const route = newRoute('7');
		expect(parseRoute(route, '7').ok).toBe(true);
		expect(route.features[0].properties.waypoints).toEqual([]);
	});
});

describe('appendWaypoint', () => {
	test('adds a waypoint without mutating the original', () => {
		const before = newRoute('1');
		const after = appendWaypoint(before, [-74.0601234567, 40.7312345678]);
		expect(before.features[0].properties.waypoints).toHaveLength(0);
		const w = after.features[0].properties.waypoints;
		expect(w).toHaveLength(1);
		expect(w[0].coordinates).toEqual([-74.060123, 40.731235]); // rounded to 6 places
		expect(w[0].id).toBeTruthy();
	});

	test('keeps waypoints in click order with distinct ids', () => {
		let r = newRoute('1');
		r = appendWaypoint(r, [-74.1, 40.7]);
		r = appendWaypoint(r, [-74.2, 40.8]);
		r = appendWaypoint(r, [-74.3, 40.9]);
		const w = r.features[0].properties.waypoints;
		expect(w.map((x) => x.coordinates[0])).toEqual([-74.1, -74.2, -74.3]);
		expect(new Set(w.map((x) => x.id)).size).toBe(3);
		expect(parseRoute(r).ok).toBe(true);
	});

	test('only touches the requested path', () => {
		const base = newRoute('1');
		const two = { ...base, features: [base.features[0], { ...base.features[0], id: 'other' }] };
		const out = appendWaypoint(two, [-74, 40], 1);
		expect(out.features[0].properties.waypoints).toHaveLength(0);
		expect(out.features[1].properties.waypoints).toHaveLength(1);
	});
});

describe('deriveGeometry', () => {
	test('needs 2+ waypoints for a line', async () => {
		let r = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		expect((await deriveGeometry(r, new StraightLineRouter())).features[0].geometry.coordinates).toEqual([]);
		r = appendWaypoint(r, [-74.2, 40.8]);
		const out = await deriveGeometry(r, new StraightLineRouter());
		expect(out.features[0].geometry.coordinates).toEqual([
			[-74.1, 40.7],
			[-74.2, 40.8]
		]);
	});

	test('uses whatever line the router returns', async () => {
		const router: Router = { route: async (w) => [w[0], [-74.15, 40.75], w[w.length - 1]] };
		let r = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		r = appendWaypoint(r, [-74.2, 40.8]);
		const out = await deriveGeometry(r, router);
		expect(out.features[0].geometry.coordinates).toHaveLength(3);
		expect(parseRoute(out).ok).toBe(true);
	});

	test('propagates router failures, and straightGeometry is the fallback', async () => {
		const failing: Router = {
			route: async () => {
				throw new Error('no route');
			}
		};
		let r = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		r = appendWaypoint(r, [-74.2, 40.8]);
		await expect(deriveGeometry(r, failing)).rejects.toThrow('no route');
		expect(straightGeometry(r).features[0].geometry.coordinates).toHaveLength(2);
	});
});

describe('map data', () => {
	test('lines only for paths with a drawable line, carrying the color', async () => {
		let r = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		expect(pathLines(r).features).toHaveLength(0);
		r = appendWaypoint(r, [-74.2, 40.8]);
		const lines = pathLines(await deriveGeometry(r, new StraightLineRouter()));
		expect(lines.features).toHaveLength(1);
		expect(lines.features[0].properties.color).toBe('#e63946');
		expect(pathLines(null).features).toEqual([]);
	});

	test('flags the first and last waypoints as endpoints', () => {
		let r = newRoute('1');
		for (const x of [-74.1, -74.2, -74.3]) r = appendWaypoint(r, [x, 40.7]);
		expect(waypointPoints(r).features.map((f) => f.properties.endpoint)).toEqual([true, false, true]);
		r = newRoute('1');
		r = appendWaypoint(r, [-74.1, 40.7]);
		expect(waypointPoints(r).features[0].properties.endpoint).toBe(true);
	});

	test('tells each waypoint which path it belongs to, and lines get a readable label color', async () => {
		const base = appendWaypoint(appendWaypoint(newRoute('1'), [-74.1, 40.7]), [-74.2, 40.8]);
		const two = { ...base, features: [base.features[0], { ...base.features[0], id: 'ret' }] };
		expect(waypointPoints(two).features.map((f) => f.properties.path)).toEqual([0, 0, 1, 1]);
		const lines = pathLines(await deriveGeometry(base, new StraightLineRouter()));
		expect(lines.features[0].properties.textColor).toBe('#ffffff'); // on the default red
	});
});

describe('moveWaypoint', () => {
	const A: [number, number] = [-74.1, 40.7];
	const B: [number, number] = [-74.2, 40.8];
	const C: [number, number] = [-74.3, 40.9];
	const D: [number, number] = [-74.4, 41.0];
	const ids = (r: ReturnType<typeof newRoute>, p = 0) => r.features[p].properties.waypoints.map((w) => w.id);
	const at = (r: ReturnType<typeof newRoute>, p = 0) => r.features[p].properties.waypoints.map((w) => w.coordinates);

	function drawn(...points: [number, number][]) {
		let r = newRoute('1');
		for (const p of points) r = appendWaypoint(r, p);
		return r;
	}

	test('moves one interior waypoint and nothing else, without mutating', () => {
		const before = drawn(A, B, C);
		const after = moveWaypoint(before, 0, ids(before)[1], [-75.123456789, 41.5]);
		expect(at(after)).toEqual([A, [-75.123457, 41.5], C]); // rounded to 6 places
		expect(at(before)).toEqual([A, B, C]);
		expect(ids(after)).toEqual(ids(before));
	});

	test('unknown path or id leaves the route unchanged', () => {
		const r = drawn(A, B);
		expect(moveWaypoint(r, 0, 'nope', C)).toBe(r);
		expect(moveWaypoint(r, 5, ids(r)[0], C)).toBe(r);
	});

	test('on a closed loop the first and closing waypoints move together', () => {
		const loop = applyMetadata(drawn(A, B, C), { kind: 'loop' }); // A B C A
		const viaFirst = moveWaypoint(loop, 0, ids(loop)[0], D);
		expect(at(viaFirst)).toEqual([D, B, C, D]);
		const viaClosing = moveWaypoint(loop, 0, ids(loop)[3], D);
		expect(at(viaClosing)).toEqual([D, B, C, D]);
		expect(parseRoute(viaFirst).ok).toBe(true);
		// an interior waypoint moves alone
		expect(at(moveWaypoint(loop, 0, ids(loop)[1], D))).toEqual([A, D, C, A]);
	});

	function twoPaths() {
		// path 0: A to B via M; path 1 (return): B to A via X
		const M: [number, number] = [-74.15, 40.75];
		const X: [number, number] = [-74.16, 40.72];
		const base = drawn(A, M, B);
		const ret = {
			...drawn(B, X, A).features[0],
			id: 'return',
			properties: { ...drawn(B, X, A).features[0].properties, direction: 1 as const }
		};
		return { route: { ...base, features: [base.features[0], ret] }, M, X };
	}

	test('moving an endpoint also moves the matching endpoint of the other path', () => {
		const { route, M, X } = twoPaths();
		// move path 0's start (A): path 1's end moves too
		let out = moveWaypoint(route, 0, ids(route, 0)[0], D);
		expect(at(out, 0)).toEqual([D, M, B]);
		expect(at(out, 1)).toEqual([B, X, D]);
		expect(parseRoute(out).ok).toBe(true);
		// move path 0's end (B): path 1's start moves too
		out = moveWaypoint(route, 0, ids(route, 0)[2], D);
		expect(at(out, 0)).toEqual([A, M, D]);
		expect(at(out, 1)).toEqual([D, X, A]);
		// and the other way around: path 1's start (B) moves path 0's end
		out = moveWaypoint(route, 1, ids(route, 1)[0], D);
		expect(at(out, 1)).toEqual([D, X, A]);
		expect(at(out, 0)).toEqual([A, M, D]);
		expect(parseRoute(out).ok).toBe(true);
	});

	test('moving an interior waypoint of one path leaves the other path alone', () => {
		const { route, X } = twoPaths();
		const out = moveWaypoint(route, 1, ids(route, 1)[1], D);
		expect(at(out, 1)[1]).toEqual(D);
		expect(at(out, 0)).toEqual(at(route, 0));
		expect(X).toBeTruthy();
	});
});
