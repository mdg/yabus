import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowDevSecret, resetSecretCache, verifyToken } from './jwt.ts';
import { createRateLimiter } from './rateLimit.ts';
import { signUp, type SignUpLimits } from './signup.ts';
import { StorageError } from './storage.ts';
import { getUser } from './users.ts';

const secret = new Uint8Array(32).fill(7);
let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'yabus-signup-'));
	process.env.YABUS_DATA_DIR = root;
});
afterAll(async () => {
	delete process.env.YABUS_DATA_DIR;
	await rm(root, { recursive: true, force: true });
});

const limits = (over: Partial<{ attempts: number; successes: number; maxUsers: number }> = {}): SignUpLimits => ({
	attempts: createRateLimiter({ limit: over.attempts ?? 100, windowMs: 3_600_000 }),
	successes: createRateLimiter({ limit: over.successes ?? 100, windowMs: 3_600_000 }),
	maxUsers: over.maxUsers ?? 1000
});

const failure = async (p: Promise<unknown>) => {
	try {
		await p;
		return null;
	} catch (e) {
		return e instanceof StorageError ? e : (e as Error);
	}
};

describe('signUp', () => {
	test('creates the user and returns a token that verifies as them', async () => {
		const result = await signUp('newcomer', '1.1.1.1', limits(), { secret });
		expect(result.user.username).toBe('newcomer');
		const claims = await verifyToken(result.token, { secret });
		expect(claims.userId).toBe(result.user.userId);
		expect(claims.username).toBe('newcomer');
		expect(result.expiresAt.getTime()).toBe(claims.exp * 1000);
		expect((await getUser('newcomer'))?.userId).toBe(result.user.userId);
	});

	test('does not hand a token to an existing user’s name', async () => {
		await signUp('already-here', '1.1.1.1', limits(), { secret });
		const error = await failure(signUp('already-here', '2.2.2.2', limits(), { secret }));
		expect((error as StorageError).status).toBe(409);
	});

	test('rejects a missing or non-string name with a 400', async () => {
		for (const bad of [undefined, null, 5, {}, ['abc']]) {
			expect(((await failure(signUp(bad, '1.1.1.1', limits(), { secret }))) as StorageError).status).toBe(400);
		}
	});

	test('rejects invalid and reserved names with a 400', async () => {
		for (const bad of ['no', 'bad name', 'admin']) {
			expect(((await failure(signUp(bad, '1.1.1.1', limits(), { secret }))) as StorageError).status).toBe(400);
		}
	});

	test('too many successful sign-ups from one address is a 429 with Retry-After', async () => {
		const l = limits({ successes: 2 });
		await signUp('limited-one', '3.3.3.3', l, { secret });
		await signUp('limited-two', '3.3.3.3', l, { secret });
		const error = (await failure(signUp('limited-three', '3.3.3.3', l, { secret }))) as StorageError;
		expect(error.status).toBe(429);
		expect(Number(error.headers['retry-after'])).toBeGreaterThanOrEqual(1);
		expect(await getUser('limited-three')).toBeNull();
		// another address is unaffected
		await signUp('limited-four', '4.4.4.4', l, { secret });
	});

	test('failed attempts count against a looser limit', async () => {
		const l = limits({ attempts: 3 });
		for (let i = 0; i < 3; i++) await failure(signUp('no', '5.5.5.5', l, { secret })); // 400s
		const error = (await failure(signUp('would-be-fine', '5.5.5.5', l, { secret }))) as StorageError;
		expect(error.status).toBe(429);
	});

	test('a good sign-up after some typos still works within the limits', async () => {
		const l = limits({ attempts: 30, successes: 5 });
		for (let i = 0; i < 4; i++) await failure(signUp('x', '6.6.6.6', l, { secret }));
		expect((await signUp('after-typos', '6.6.6.6', l, { secret })).user.username).toBe('after-typos');
	});

	test('stops at the user cap with a 503', async () => {
		const error = (await failure(signUp('too-many-users', '7.7.7.7', limits({ maxUsers: 1 }), { secret }))) as StorageError;
		expect(error.status).toBe(503);
		expect(await getUser('too-many-users')).toBeNull();
	});

	describe('with no signing secret configured', () => {
		const saved = { env: process.env.YABUS_JWT_SECRET };
		afterEach(() => {
			resetSecretCache();
			allowDevSecret(false);
			if (saved.env === undefined) delete process.env.YABUS_JWT_SECRET;
			else process.env.YABUS_JWT_SECRET = saved.env;
		});

		test('it fails before claiming a name, so no name is left without a token', async () => {
			delete process.env.YABUS_JWT_SECRET;
			allowDevSecret(false);
			resetSecretCache();
			const before = await readdir(root);
			const error = await failure(signUp('no-secret-user', '8.8.8.8', limits())); // no opts.secret
			expect(error).toBeInstanceOf(Error);
			expect(await readdir(root)).toEqual(before);
		});
	});
});
