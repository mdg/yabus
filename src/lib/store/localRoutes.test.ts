import { describe, expect, test } from 'bun:test';
import type { RouteCollection } from '#lib/geo/types.ts';
import { createLocalRoutes } from './localRoutes.ts';

function fakeStorage() {
	const m = new Map<string, string>();
	return {
		map: m,
		get length() {
			return m.size;
		},
		key: (i: number) => [...m.keys()][i] ?? null,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k)
	};
}

const route = (number: string): RouteCollection => ({
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'p',
			geometry: { type: 'LineString', coordinates: [] },
			properties: {
				kind: 'point-to-point',
				direction: 0,
				number,
				name: 'Test',
				color: '#112233',
				waypoints: []
			}
		}
	]
});

describe('localRoutes', () => {
	test('saves, reads, lists and removes routes', () => {
		const store = createLocalRoutes('demo', fakeStorage());
		store.save(route('10'));
		store.save(route('2'));
		expect(store.list()).toEqual(['2', '10']);
		expect(store.has('2')).toBe(true);
		expect(store.get('10')?.features[0].properties.number).toBe('10');
		store.remove('2');
		expect(store.list()).toEqual(['10']);
		expect(store.get('2')).toBeNull();
	});

	test('keys by username and keeps users apart', () => {
		const storage = fakeStorage();
		createLocalRoutes('demo', storage).save(route('1'));
		expect(createLocalRoutes('other', storage).list()).toEqual([]);
		expect([...storage.map.keys()]).toEqual(['yabus:route:v1:demo:1']);
	});

	test('refuses invalid routes and ignores corrupt entries', () => {
		const storage = fakeStorage();
		const store = createLocalRoutes('demo', storage);
		expect(() => store.save({ type: 'FeatureCollection', features: [] })).toThrow();
		storage.setItem('yabus:route:v1:demo:5', '{not json');
		expect(store.get('5')).toBeNull();
	});

	test('reports a storage failure when saving', () => {
		const storage = fakeStorage();
		storage.setItem = () => {
			throw new Error('quota');
		};
		expect(() => createLocalRoutes('demo', storage).save(route('1'))).toThrow('could not save');
	});
});
