import { describe, expect, test } from 'bun:test';
import { appendWaypoint, straightGeometry } from './edit.ts';
import { newRoute } from './factory.ts';
import { applyMetadata } from './meta.ts';
import { parseRoute } from './route.ts';

const drawn = () => {
	let r = newRoute('3');
	for (const p of [[-74.1, 40.7], [-74.05, 40.72], [-74.0, 40.75]] as [number, number][]) r = appendWaypoint(r, p);
	return straightGeometry(r);
};

describe('duplicateRoute', async () => {
	const { duplicateRoute } = await import('./duplicate.ts');

	test('copies the shape under a new number with all-new ids', () => {
		const original = drawn();
		const copy = duplicateRoute(original, '8');
		expect(parseRoute(copy, '8').ok).toBe(true);
		const a = original.features[0];
		const b = copy.features[0];
		expect(b.properties.number).toBe('8');
		expect(b.properties.color).toBe(a.properties.color);
		expect(b.properties.kind).toBe(a.properties.kind);
		expect(b.geometry.coordinates).toEqual(a.geometry.coordinates);
		expect(b.properties.waypoints.map((w) => w.coordinates)).toEqual(a.properties.waypoints.map((w) => w.coordinates));
		expect(b.id).not.toBe(a.id);
		const oldIds = new Set(a.properties.waypoints.map((w) => w.id));
		expect(b.properties.waypoints.every((w) => !oldIds.has(w.id))).toBe(true);
	});

	test('shares nothing with the original', () => {
		const original = drawn();
		const copy = duplicateRoute(original, '8');
		copy.features[0].geometry.coordinates[0][0] = 0;
		copy.features[0].properties.waypoints[0].coordinates[0] = 0;
		expect(original.features[0].geometry.coordinates[0][0]).toBe(-74.1);
		expect(original.features[0].properties.waypoints[0].coordinates[0]).toBe(-74.1);
	});

	test('a default name follows the new number, a custom name is kept', () => {
		expect(duplicateRoute(drawn(), '8').features[0].properties.name).toBe('Route 8');
		const custom = applyMetadata(drawn(), { name: 'Hoboken Express' });
		expect(duplicateRoute(custom, '8').features[0].properties.name).toBe('Hoboken Express');
	});

	test('keeps a loop closed and both paths of a two-way route', () => {
		const loop = straightGeometry(applyMetadata(drawn(), { kind: 'loop' }));
		const loopCopy = duplicateRoute(loop, '9');
		expect(parseRoute(loopCopy).ok).toBe(true);

		const base = drawn();
		const w = base.features[0].properties.waypoints;
		const ret = {
			...base.features[0],
			id: 'ret',
			properties: { ...base.features[0].properties, direction: 1 as const, waypoints: [...w].reverse() }
		};
		const two = straightGeometry({ ...base, features: [base.features[0], ret] });
		const twoCopy = duplicateRoute(two, '10');
		expect(twoCopy.features).toHaveLength(2);
		expect(twoCopy.features.map((f) => f.properties.direction)).toEqual([0, 1]);
		expect(parseRoute(twoCopy).ok).toBe(true);
	});
});
