import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ULID_RE, StorageError } from './storage.ts';
import { countUsers, createUser, getUser, userDir } from './users.ts';

let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'yabus-users-'));
	process.env.YABUS_DATA_DIR = root;
});
afterAll(async () => {
	delete process.env.YABUS_DATA_DIR;
	await rm(root, { recursive: true, force: true });
});

const failure = async (p: Promise<unknown>) => {
	try {
		await p;
		return null;
	} catch (e) {
		return e instanceof StorageError ? e.status : -1;
	}
};

describe('createUser', () => {
	test('claims data/{userName}/ and writes user.json with a new ULID', async () => {
		const user = await createUser('alice');
		expect(user.username).toBe('alice');
		expect(user.userId).toMatch(ULID_RE);
		expect(user.tokensValidAfter).toBeNull();
		expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false);
		const onDisk = JSON.parse(await readFile(join(root, 'alice', 'user.json'), 'utf8'));
		expect(onDisk).toEqual(user);
	});

	test('the directory is named by the user name, not the ID', async () => {
		const user = await createUser('named-by-name');
		const entries = await readdir(root);
		expect(entries).toContain('named-by-name');
		expect(entries).not.toContain(user.userId);
	});

	test('trims and lowercases, so Demo and demo are one name', async () => {
		const user = await createUser('  MixedCase ');
		expect(user.username).toBe('mixedcase');
		expect(await failure(createUser('MIXEDCASE'))).toBe(409);
	});

	test('a taken name is a 409 and the first user is untouched', async () => {
		const first = await createUser('taken-name');
		expect(await failure(createUser('taken-name'))).toBe(409);
		expect((await getUser('taken-name'))?.userId).toBe(first.userId);
	});

	test('invalid and reserved names are a 400 and create nothing', async () => {
		const before = await readdir(root);
		for (const bad of ['', 'ab', 'a b', '../evil', 'a/b', 'x'.repeat(40), 'admin', 'API']) {
			expect(await failure(createUser(bad))).toBe(400);
		}
		expect(await readdir(root)).toEqual(before);
	});

	test('of several simultaneous sign-ups for one name exactly one wins', async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () => createUser('raced-name').then(() => 'ok', (e: StorageError) => e.status))
		);
		expect(results.filter((r) => r === 'ok')).toHaveLength(1);
		expect(results.filter((r) => r === 409)).toHaveLength(7);
	});

	test('every user gets a different ULID', async () => {
		const ids = new Set<string>();
		for (let i = 0; i < 5; i++) ids.add((await createUser(`unique-${i}`)).userId);
		expect(ids.size).toBe(5);
	});

	test('stops at the user cap with a 503', async () => {
		const count = await countUsers();
		expect(await failure(createUser('over-the-cap', { maxUsers: count }))).toBe(503);
		await createUser('under-the-cap', { maxUsers: count + 1 });
		expect(await getUser('over-the-cap')).toBeNull();
	});
});

describe('getUser', () => {
	test('finds a user by name, ignoring case', async () => {
		const user = await createUser('findable');
		expect(await getUser('findable')).toEqual(user);
		expect(await getUser('FindAble')).toEqual(user);
	});

	test('is null for unknown or invalid names, never an error', async () => {
		expect(await getUser('nobody-here')).toBeNull();
		expect(await getUser('../../etc')).toBeNull();
		expect(await getUser('')).toBeNull();
		expect(await getUser('a/b')).toBeNull();
	});

	test('is null for a record that is damaged or does not belong to its directory', async () => {
		await mkdir(join(root, 'broken-json'));
		await writeFile(join(root, 'broken-json', 'user.json'), '{not json');
		expect(await getUser('broken-json')).toBeNull();

		const other = await createUser('other-user');
		await mkdir(join(root, 'wrong-dir'));
		await writeFile(join(root, 'wrong-dir', 'user.json'), JSON.stringify(other)); // says "other-user"
		expect(await getUser('wrong-dir')).toBeNull();

		await mkdir(join(root, 'bad-id'));
		await writeFile(join(root, 'bad-id', 'user.json'), JSON.stringify({ ...other, username: 'bad-id', userId: 'nope' }));
		expect(await getUser('bad-id')).toBeNull();

		await mkdir(join(root, 'no-record')); // a directory with no user.json
		expect(await getUser('no-record')).toBeNull();
	});
});

describe('userDir and countUsers', () => {
	test('userDir only accepts safe names', () => {
		expect(userDir('alice')).toBe(join(root, 'alice'));
		expect(() => userDir('../x')).toThrow();
		expect(() => userDir('A')).toThrow();
	});

	test('countUsers counts user-name directories and ignores other things', async () => {
		const before = await countUsers();
		await mkdir(join(root, 'UPPER-LEGACY-01M7NK55ZADBJSQS1A3DGQ482G'));
		await writeFile(join(root, '.jwt-secret'), 'x');
		expect(await countUsers()).toBe(before);
		await createUser('one-more');
		expect(await countUsers()).toBe(before + 1);
	});
});
