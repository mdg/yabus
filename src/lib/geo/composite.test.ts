import { describe, expect, test } from 'bun:test';
import { compositeBounds, mergeComposite } from './composite.ts';
import { appendWaypoint, straightGeometry } from './edit.ts';
import { newRoute } from './factory.ts';
import { endpointPoints, pathLines } from '#lib/map/routeData.ts';
import type { Position } from './types.ts';

const route = (number: string, name: string, ...points: Position[]) => {
	let r = newRoute(number);
	r = { ...r, features: [{ ...r.features[0], properties: { ...r.features[0].properties, name } }] };
	for (const p of points) r = appendWaypoint(r, p);
	return straightGeometry(r);
};
const numbers = (entries: ReturnType<typeof mergeComposite>) =>
	entries.map((e) => `${e.route.features[0].properties.number}:${e.source}`);

describe('mergeComposite', () => {
	test('local routes are editable, server-only routes are read-only', () => {
		const out = mergeComposite([route('1', 'a')], [route('5', 'b')]);
		expect(numbers(out)).toEqual(['1:local', '5:server']);
	});

	test('local wins when a number exists in both places', () => {
		const out = mergeComposite([route('1', 'local copy')], [route('1', 'server copy'), route('2', 'x')]);
		expect(numbers(out)).toEqual(['1:local', '2:server']);
		expect(out[0].route.features[0].properties.name).toBe('local copy');
	});

	test('ignores case when matching numbers, and sorts naturally', () => {
		const out = mergeComposite(
			[route('10', 'a'), route('N3', 'a')],
			[route('n3', 'server'), route('2', 'b'), route('1', 'c')]
		);
		expect(numbers(out)).toEqual(['1:server', '2:server', '10:local', 'N3:local']);
	});

	test('works with nothing at all', () => {
		expect(mergeComposite([], [])).toEqual([]);
	});
});

describe('compositeBounds', () => {
	test('covers every path of every route', () => {
		const a = route('1', 'a', [-74.1, 40.7], [-74.0, 40.8]);
		const b = route('2', 'b', [-73.9, 40.6], [-74.05, 40.75]);
		expect(compositeBounds([a, b])).toEqual({ west: -74.1, south: 40.6, east: -73.9, north: 40.8 });
	});

	test('falls back to waypoints for a route with no line yet', () => {
		const lone = route('1', 'a', [-74.0, 40.7]); // one waypoint, no line
		expect(compositeBounds([lone])).toEqual({ west: -74.0, south: 40.7, east: -74.0, north: 40.7 });
	});

	test('is null when there is nothing to show', () => {
		expect(compositeBounds([])).toBeNull();
		expect(compositeBounds([route('1', 'empty')])).toBeNull();
	});
});

describe('map data for several routes', () => {
	test('lines from every route, markers only at endpoints', () => {
		const a = route('1', 'a', [-74.1, 40.7], [-74.05, 40.72], [-74.0, 40.8]);
		const b = route('2', 'b', [-73.9, 40.6], [-73.95, 40.65]);
		expect(pathLines([a, b]).features.map((f) => f.properties.number)).toEqual(['1', '2']);
		expect(pathLines(a).features).toHaveLength(1); // a single route still works
		expect(pathLines(null).features).toEqual([]);
		// a has 3 waypoints (2 endpoints), b has 2 (both endpoints)
		expect(endpointPoints([a, b]).features).toHaveLength(4);
	});
});
