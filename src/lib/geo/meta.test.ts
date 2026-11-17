import { describe, expect, test } from 'bun:test';
import { appendWaypoint, deriveGeometry, mergeGeometry } from './edit.ts';
import { newRoute } from './factory.ts';
import { closeLoop, isClosed, openLoop } from './loop.ts';
import { applyMetadata } from './meta.ts';
import { parseRoute } from './route.ts';
import { StraightLineRouter } from '#lib/routing/router.ts';
import type { RouteCollection } from './types.ts';

const click = (r: RouteCollection, ...points: [number, number][]) =>
	points.reduce((acc, p) => appendWaypoint(acc, p), r);
const wp = (r: RouteCollection) => r.features[0].properties.waypoints;
const A: [number, number] = [-74.1, 40.7];
const B: [number, number] = [-74.2, 40.8];
const C: [number, number] = [-74.3, 40.9];

describe('applyMetadata', () => {
	test('changes name, color and number on every path', () => {
		const base = newRoute('1');
		const two = { ...base, features: [base.features[0], { ...base.features[0], id: 'x' }] };
		const out = applyMetadata(two, { name: 'Loop', color: '#112233', number: '9' });
		for (const f of out.features) {
			expect(f.properties.name).toBe('Loop');
			expect(f.properties.color).toBe('#112233');
			expect(f.properties.number).toBe('9');
		}
	});

	test('does not mutate the original', () => {
		const base = newRoute('1');
		applyMetadata(base, { name: 'Changed' });
		expect(base.features[0].properties.name).toBe('Route 1');
	});

	test('turning a drawn route into a loop closes it, and back opens it', () => {
		const drawn = click(newRoute('1'), A, B, C);
		const loop = applyMetadata(drawn, { kind: 'loop' });
		expect(wp(loop)).toHaveLength(4);
		expect(isClosed(wp(loop))).toBe(true);
		expect(parseRoute(loop).ok).toBe(true);

		const back = applyMetadata(loop, { kind: 'point-to-point' });
		expect(wp(back)).toHaveLength(3);
		expect(isClosed(wp(back))).toBe(false);
		expect(parseRoute(back).ok).toBe(true);
	});

	test('switching an empty or one-waypoint route to a loop is valid', () => {
		expect(parseRoute(applyMetadata(newRoute('1'), { kind: 'loop' })).ok).toBe(true);
		const one = applyMetadata(click(newRoute('1'), A), { kind: 'loop' });
		expect(wp(one)).toHaveLength(1);
		expect(parseRoute(one).ok).toBe(true);
	});

	test('a route with a return path cannot become a loop', () => {
		const base = newRoute('1');
		const two = {
			...base,
			features: [base.features[0], { ...base.features[0], id: 'x', properties: { ...base.features[0].properties, direction: 1 as const } }]
		};
		expect(() => applyMetadata(two, { kind: 'loop' })).toThrow('single path');
	});
});

describe('loops while drawing', () => {
	test('each click on a loop goes before the closing waypoint and keeps it closed', () => {
		let r = applyMetadata(newRoute('1'), { kind: 'loop' });
		r = click(r, A);
		expect(wp(r)).toHaveLength(1);
		r = click(r, B);
		expect(wp(r).map((w) => w.coordinates)).toEqual([A, B, A]);
		r = click(r, C);
		expect(wp(r).map((w) => w.coordinates)).toEqual([A, B, C, A]);
		expect(parseRoute(r).ok).toBe(true);
	});

	test('closing waypoint helpers', () => {
		const r = click(newRoute('1'), A, B);
		expect(isClosed(wp(r))).toBe(false);
		expect(closeLoop(wp(r))).toHaveLength(3);
		expect(openLoop(closeLoop(wp(r)))).toHaveLength(2);
		expect(closeLoop(closeLoop(wp(r)))).toHaveLength(3); // idempotent
	});

	test('a loop gets a drawable closed line', async () => {
		const r = applyMetadata(click(newRoute('1'), A, B, C), { kind: 'loop' });
		const out = await deriveGeometry(r, new StraightLineRouter());
		const line = out.features[0].geometry.coordinates;
		expect(line[0]).toEqual(line[line.length - 1]);
	});
});

describe('mergeGeometry', () => {
	test('takes the new line but keeps newer metadata', async () => {
		const snapshot = click(newRoute('1'), A, B);
		const derived = await deriveGeometry(snapshot, new StraightLineRouter());
		const current = applyMetadata(snapshot, { name: 'Renamed' }); // edited while deriving
		const merged = mergeGeometry(current, derived);
		expect(merged.features[0].properties.name).toBe('Renamed');
		expect(merged.features[0].geometry.coordinates).toHaveLength(2);
	});
});
