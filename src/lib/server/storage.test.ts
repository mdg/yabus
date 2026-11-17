import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteCollection } from '#lib/geo/types.ts';
import { deleteRoute, listRouteNumbers, readRoute, StorageError, writeRoute } from './storage.ts';
import { createUser, userDir } from './users.ts';

let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'yabus-test-'));
	process.env.YABUS_DATA_DIR = root;
});
afterAll(async () => {
	delete process.env.YABUS_DATA_DIR;
	await rm(root, { recursive: true, force: true });
});

const route = (number: string): RouteCollection => ({
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'p',
			geometry: { type: 'LineString', coordinates: [[-74, 40.7], [-74.1, 40.8]] },
			properties: {
				kind: 'point-to-point',
				direction: 0,
				number,
				name: 'Test',
				color: '#112233',
				waypoints: [
					{ id: 'a', coordinates: [-74, 40.7] },
					{ id: 'b', coordinates: [-74.1, 40.8] }
				]
			}
		}
	]
});

const status = async (p: Promise<unknown>) => {
	try {
		await p;
		return 0;
	} catch (e) {
		return e instanceof StorageError ? e.status : -1;
	}
};

describe('route files', () => {
	test('write, read, list, overwrite and delete', async () => {
		await createUser('files');
		const dir = userDir('files');
		await writeRoute(dir, '10', route('10'));
		await writeRoute(dir, '2', route('2'));
		expect(await listRouteNumbers(dir)).toEqual(['2', '10']);
		expect((await readRoute(dir, '2'))?.features[0].properties.number).toBe('2');
		expect(await readRoute(dir, '99')).toBeNull();

		const changed = route('2');
		changed.features[0].properties.name = 'Changed';
		await writeRoute(dir, '2', changed);
		expect((await readRoute(dir, '2'))?.features[0].properties.name).toBe('Changed');

		await deleteRoute(dir, '2');
		await deleteRoute(dir, '2'); // deleting twice is fine
		expect(await listRouteNumbers(dir)).toEqual(['10']);
		// no temp files left behind
		expect((await readdir(dir)).sort()).toEqual(['10.geojson', 'user.json']);
	});

	test('route numbers that could escape the directory are rejected', async () => {
		await createUser('paths');
		const dir = userDir('paths');
		for (const bad of ['../x', 'a/b', '.hidden', '', 'x'.repeat(40)]) {
			expect(await status(writeRoute(dir, bad, route('1')))).toBe(400);
			expect(await status(readRoute(dir, bad))).toBe(400);
			expect(await status(deleteRoute(dir, bad))).toBe(400);
		}
	});
});
