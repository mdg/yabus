import { describe, expect, test } from 'bun:test';
import { StraightLineRouter, type Router } from '#lib/routing/router.ts';
import { pathLines, waypointPoints } from '#lib/map/routeData.ts';
import { appendWaypoint, deriveGeometry, straightGeometry } from './edit.ts';
import { newRoute } from './factory.ts';
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
});
