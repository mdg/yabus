import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteCollection } from '#lib/geo/types.ts';
import {
	authorizeSession,
	createSession,
	deleteRoute,
	findReadDir,
	isValidSession,
	listRouteNumbers,
	readRoute,
	StorageError,
	writeRoute
} from './storage.ts';

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

describe('sessions', () => {
	test('createSession makes a new directory with a write-once session.json', async () => {
		const id = await createSession('demo');
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		const dir = join(root, `demo-${id}`);
		expect(JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))).toEqual({
			sessionId: id
		});
	});

	test('every new session gets its own directory and the old one is untouched', async () => {
		const a = await createSession('demo');
		const before = await readFile(join(root, `demo-${a}`, 'session.json'), 'utf8');
		const b = await createSession('demo');
		expect(b).not.toBe(a);
		expect(await readFile(join(root, `demo-${a}`, 'session.json'), 'utf8')).toBe(before);
		expect(await isValidSession('demo', a)).toBe(true);
		expect(await isValidSession('demo', b)).toBe(true);
	});

	test('authorizeSession rejects missing, malformed, unknown and mismatched sessions', async () => {
		const id = await createSession('demo');
		expect(await authorizeSession('demo', id)).toBe(join(root, `demo-${id}`));
		expect(await status(authorizeSession('demo', undefined))).toBe(403);
		expect(await status(authorizeSession('demo', ''))).toBe(403);
		expect(await status(authorizeSession('demo', '../../etc'))).toBe(403);
		expect(await status(authorizeSession('demo', '0'.repeat(26)))).toBe(403); // no directory
		expect(await status(authorizeSession('nobody', id))).toBe(403); // wrong username
		expect(await status(authorizeSession('../x', id))).toBe(400);

		// session.json that disagrees with the directory name is refused.
		const other = await createSession('demo');
		await writeFile(join(root, `demo-${other}`, 'session.json'), JSON.stringify({ sessionId: id }));
		expect(await status(authorizeSession('demo', other))).toBe(403);
		// unreadable session.json is refused.
		await writeFile(join(root, `demo-${other}`, 'session.json'), 'not json');
		expect(await status(authorizeSession('demo', other))).toBe(403);
	});
});

describe('findReadDir', () => {
	test('picks the first (oldest) directory for the username', async () => {
		const dir = join(root, 'solo-01AAAAAAAAAAAAAAAAAAAAAAAA');
		await mkdir(dir);
		await mkdir(join(root, 'solo-01BBBBBBBBBBBBBBBBBBBBBBBB'));
		expect(await findReadDir('solo')).toBe(dir);
	});

	test('does not let one username match another that starts with it', async () => {
		await mkdir(join(root, 'al-bob-01CCCCCCCCCCCCCCCCCCCCCCCC'));
		expect(await findReadDir('al')).toBeNull();
		expect(await findReadDir('al-bob')).toBe(join(root, 'al-bob-01CCCCCCCCCCCCCCCCCCCCCCCC'));
	});

	test('returns null when the data directory does not exist yet', async () => {
		const saved = process.env.YABUS_DATA_DIR;
		process.env.YABUS_DATA_DIR = join(root, 'does-not-exist');
		expect(await findReadDir('demo')).toBeNull();
		process.env.YABUS_DATA_DIR = saved;
	});
});

describe('route files', () => {
	test('write, read, list, overwrite and delete', async () => {
		const id = await createSession('files');
		const dir = await authorizeSession('files', id);
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
		expect((await readdir(dir)).sort()).toEqual(['10.geojson', 'session.json']);
	});

	test('route numbers that could escape the directory are rejected', async () => {
		const id = await createSession('paths');
		const dir = await authorizeSession('paths', id);
		for (const bad of ['../x', 'a/b', '.hidden', '', 'x'.repeat(40)]) {
			expect(await status(writeRoute(dir, bad, route('1')))).toBe(400);
			expect(await status(readRoute(dir, bad))).toBe(400);
			expect(await status(deleteRoute(dir, bad))).toBe(400);
		}
	});
});
