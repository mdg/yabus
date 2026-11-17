import { describe, expect, test } from 'bun:test';
import { parseRoute } from './route.ts';
import type { PathFeature, Position, RouteCollection } from './types.ts';

const A: Position = [-74.06, 40.73];
const M: Position = [-74.05, 40.74];
const B: Position = [-74.03, 40.75];
const X: Position = [-74.04, 40.72];

function path(
	direction: 0 | 1,
	points: Position[],
	over: Partial<PathFeature['properties']> = {}
): PathFeature {
	return {
		type: 'Feature',
		id: `p${direction}`,
		geometry: { type: 'LineString', coordinates: points },
		properties: {
			kind: 'point-to-point',
			direction,
			number: '42',
			name: 'Test',
			color: '#e63946',
			waypoints: points.map((coordinates, i) => ({ id: `w${direction}${i}`, coordinates })),
			...over
		}
	};
}

const route = (...features: PathFeature[]): RouteCollection => ({
	type: 'FeatureCollection',
	features
});

describe('parseRoute', () => {
	test('accepts a one-direction point-to-point route', () => {
		expect(parseRoute(route(path(0, [A, M, B])), '42').ok).toBe(true);
	});

	test('accepts a loop whose start and end match', () => {
		const loop = path(0, [A, M, B, A], { kind: 'loop' });
		expect(parseRoute(route(loop)).ok).toBe(true);
	});

	test('rejects a loop that does not close', () => {
		const loop = path(0, [A, M, B], { kind: 'loop' });
		expect(parseRoute(route(loop)).ok).toBe(false);
	});

	test('rejects a loop with two paths', () => {
		const a = path(0, [A, M, A], { kind: 'loop' });
		const b = path(1, [A, X, A], { kind: 'loop' });
		expect(parseRoute(route(a, b)).ok).toBe(false);
	});

	test('accepts two paths with swapped endpoints and different middles', () => {
		expect(parseRoute(route(path(0, [A, M, B]), path(1, [B, X, A]))).ok).toBe(true);
	});

	test('rejects two paths whose endpoints do not match', () => {
		const result = parseRoute(route(path(0, [A, M, B]), path(1, [B, X, M])));
		expect(result.ok).toBe(false);
	});

	test('rejects two paths with the same direction', () => {
		expect(parseRoute(route(path(0, [A, M, B]), path(0, [B, X, A]))).ok).toBe(false);
	});

	test('allows an in-progress path with fewer than 2 waypoints', () => {
		expect(parseRoute(route(path(0, [A]))).ok).toBe(true);
		expect(parseRoute(route(path(0, []))).ok).toBe(true);
	});

	test('rejects route-level fields that differ between paths', () => {
		const result = parseRoute(route(path(0, [A, M, B]), path(1, [B, X, A], { name: 'Other' })));
		expect(result.ok).toBe(false);
	});

	test('rejects a number that does not match the expected one', () => {
		expect(parseRoute(route(path(0, [A, B])), '7').ok).toBe(false);
	});

	test('rejects unsafe route numbers', () => {
		expect(parseRoute(route(path(0, [A, B], { number: '../x' }))).ok).toBe(false);
		expect(parseRoute(route(path(0, [A, B], { number: '' }))).ok).toBe(false);
	});

	test('rejects bad colors, bad positions and wrong feature counts', () => {
		expect(parseRoute(route(path(0, [A, B], { color: 'red' }))).ok).toBe(false);
		expect(parseRoute(route(path(0, [[200, 0], B]))).ok).toBe(false);
		expect(parseRoute(route()).ok).toBe(false);
		expect(parseRoute(route(path(0, [A, B]), path(1, [B, A]), path(1, [B, A]))).ok).toBe(false);
		expect(parseRoute('nope').ok).toBe(false);
	});

	test('drops unknown properties', () => {
		const f = path(0, [A, B]);
		(f.properties as unknown as Record<string, unknown>).extra = 'x';
		const result = parseRoute(route(f));
		expect(result.ok && 'extra' in result.route.features[0].properties).toBe(false);
	});
});
