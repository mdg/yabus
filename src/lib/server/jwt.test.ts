import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import {
	allowDevSecret,
	getSecret,
	resetSecretCache,
	signToken,
	TOKEN_LIFETIME_SECONDS,
	verifyToken
} from './jwt.ts';
import { StorageError } from './storage.ts';

const secret = new Uint8Array(32).fill(7);
const otherSecret = new Uint8Array(32).fill(9);
const user = { userId: '01J8ZQ0000000000000000000A', username: 'alice' };

const rejected = async (p: Promise<unknown>) => {
	try {
		await p;
		return null;
	} catch (e) {
		return e instanceof StorageError ? e.status : -1;
	}
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('signToken and verifyToken', () => {
	test('round trip carries the user and lasts one year', async () => {
		const now = new Date('2026-01-01T00:00:00Z');
		const { token, expiresAt } = await signToken(user, { secret, now });
		const claims = await verifyToken(token, { secret, now });
		expect(claims.userId).toBe(user.userId);
		expect(claims.username).toBe('alice');
		expect(claims.iat).toBe(Math.floor(now.getTime() / 1000));
		expect(claims.exp - claims.iat).toBe(TOKEN_LIFETIME_SECONDS);
		expect(TOKEN_LIFETIME_SECONDS).toBe(365 * 24 * 60 * 60);
		expect(expiresAt.getTime()).toBe(claims.exp * 1000);
		expect(claims.jti).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	test('the header is HS256 and the issuer and audience are yabus', async () => {
		const { token } = await signToken(user, { secret });
		const [h, p] = token.split('.').slice(0, 2).map((s) => JSON.parse(Buffer.from(s, 'base64url').toString()));
		expect(h).toEqual({ alg: 'HS256', typ: 'JWT' });
		expect(p.iss).toBe('yabus');
		expect(p.aud).toBe('yabus');
		expect(p.sub).toBe(user.userId);
	});

	test('every token has its own jti', async () => {
		const a = await verifyToken((await signToken(user, { secret })).token, { secret });
		const b = await verifyToken((await signToken(user, { secret })).token, { secret });
		expect(a.jti).not.toBe(b.jti);
	});

	test('an expired token is a 401, a token within the clock tolerance is not', async () => {
		const issued = new Date('2026-01-01T00:00:00Z');
		const { token, expiresAt } = await signToken(user, { secret, now: issued });
		expect(await rejected(verifyToken(token, { secret, now: new Date(expiresAt.getTime() + 60_000) }))).toBe(401);
		expect(await rejected(verifyToken(token, { secret, now: new Date(expiresAt.getTime() + 10_000) }))).toBeNull();
	});

	test('a token signed with another secret is a 401', async () => {
		const { token } = await signToken(user, { secret: otherSecret });
		expect(await rejected(verifyToken(token, { secret }))).toBe(401);
	});

	test('a tampered payload is a 401', async () => {
		const { token } = await signToken(user, { secret });
		const [h, p, s] = token.split('.');
		const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
		payload.username = 'mallory';
		expect(await rejected(verifyToken(`${h}.${b64url(payload)}.${s}`, { secret }))).toBe(401);
	});

	test('alg none is a 401', async () => {
		const now = Math.floor(Date.now() / 1000);
		const payload = { iss: 'yabus', aud: 'yabus', sub: user.userId, username: 'alice', iat: now, exp: now + 1000 };
		const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
		expect(await rejected(verifyToken(token, { secret }))).toBe(401);
	});

	test('a validly signed token using another algorithm is a 401', async () => {
		const token = await new SignJWT({ username: 'alice' })
			.setProtectedHeader({ alg: 'HS512' })
			.setIssuer('yabus').setAudience('yabus').setSubject(user.userId)
			.setIssuedAt().setExpirationTime('1h')
			.sign(secret);
		expect(await rejected(verifyToken(token, { secret }))).toBe(401);
	});

	const signCustom = (claims: Record<string, unknown>, set: (j: SignJWT) => SignJWT = (j) => j) =>
		set(new SignJWT(claims).setProtectedHeader({ alg: 'HS256' })).sign(secret);

	test('wrong issuer, audience, or missing claims are a 401', async () => {
		const base = (j: SignJWT) => j.setSubject(user.userId).setIssuedAt().setExpirationTime('1h');
		const good = { username: 'alice' };
		expect(await rejected(verifyToken(await signCustom(good, (j) => base(j).setIssuer('evil').setAudience('yabus')), { secret }))).toBe(401);
		expect(await rejected(verifyToken(await signCustom(good, (j) => base(j).setIssuer('yabus').setAudience('evil')), { secret }))).toBe(401);
		expect(await rejected(verifyToken(await signCustom(good, (j) => j.setIssuer('yabus').setAudience('yabus').setSubject(user.userId).setIssuedAt()), { secret }))).toBe(401); // no exp
		expect(await rejected(verifyToken(await signCustom(good, (j) => j.setIssuer('yabus').setAudience('yabus').setSubject(user.userId).setExpirationTime('1h')), { secret }))).toBe(401); // no iat
		expect(await rejected(verifyToken(await signCustom(good, (j) => j.setIssuer('yabus').setAudience('yabus').setIssuedAt().setExpirationTime('1h')), { secret }))).toBe(401); // no sub
	});

	test('a malformed sub or username is a 401, including path characters', async () => {
		const withAll = (sub: string) => (j: SignJWT) =>
			j.setIssuer('yabus').setAudience('yabus').setSubject(sub).setIssuedAt().setExpirationTime('1h');
		expect(await rejected(verifyToken(await signCustom({ username: 'alice' }, withAll('not-a-ulid')), { secret }))).toBe(401);
		for (const bad of ['../etc', 'a/b', 'Alice', 'ab', '', 'x'.repeat(40)]) {
			expect(await rejected(verifyToken(await signCustom({ username: bad }, withAll(user.userId)), { secret }))).toBe(401);
		}
		expect(await rejected(verifyToken(await signCustom({}, withAll(user.userId)), { secret }))).toBe(401); // no username
		expect(await rejected(verifyToken(await signCustom({ username: 5 }, withAll(user.userId)), { secret }))).toBe(401);
	});

	test('garbage is a 401 that carries WWW-Authenticate', async () => {
		for (const bad of ['', 'abc', 'a.b.c', '....']) expect(await rejected(verifyToken(bad, { secret }))).toBe(401);
		try {
			await verifyToken('abc', { secret });
		} catch (e) {
			expect((e as StorageError).headers['www-authenticate']).toBe('Bearer');
		}
	});
});

describe('the signing secret', () => {
	const saved = { env: process.env.YABUS_JWT_SECRET, dir: process.env.YABUS_DATA_DIR };
	let root: string;
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'yabus-secret-'));
	});
	afterEach(async () => {
		resetSecretCache();
		allowDevSecret(false); // the default
		for (const [key, value] of [['YABUS_JWT_SECRET', saved.env], ['YABUS_DATA_DIR', saved.dir]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(join(root, '.jwt-secret'), { force: true });
	});

	test('is taken from YABUS_JWT_SECRET', async () => {
		process.env.YABUS_JWT_SECRET = Buffer.alloc(32, 5).toString('base64');
		expect(Array.from(await getSecret())).toEqual(Array(32).fill(5));
	});

	test('a short or non-base64 secret is refused', async () => {
		process.env.YABUS_JWT_SECRET = Buffer.alloc(8, 1).toString('base64');
		await expect(getSecret()).rejects.toThrow('at least 32 bytes');
		process.env.YABUS_JWT_SECRET = 'not base64!!';
		await expect(getSecret()).rejects.toThrow('base64');
	});

	test('by default (no dev secret allowed) a missing secret is an error', async () => {
		delete process.env.YABUS_JWT_SECRET;
		process.env.YABUS_DATA_DIR = root;
		await expect(getSecret()).rejects.toThrow('YABUS_JWT_SECRET must be set');
		// and it did not quietly create a dev secret file
		await expect(stat(join(root, '.jwt-secret'))).rejects.toThrow();
	});

	test('a configured secret is used even when a dev secret is allowed, and no file is made', async () => {
		process.env.YABUS_JWT_SECRET = Buffer.alloc(32, 4).toString('base64');
		process.env.YABUS_DATA_DIR = root;
		allowDevSecret(true);
		expect((await getSecret())[0]).toBe(4);
		await expect(stat(join(root, '.jwt-secret'))).rejects.toThrow();
	});

	test('when a dev secret is allowed, a file is created once (mode 0600) and reused', async () => {
		delete process.env.YABUS_JWT_SECRET;
		process.env.YABUS_DATA_DIR = root;
		allowDevSecret(true);
		const first = await getSecret();
		expect(first.length).toBeGreaterThanOrEqual(32);
		expect((await stat(join(root, '.jwt-secret'))).mode & 0o777).toBe(0o600);

		resetSecretCache(); // as after a restart
		expect(Array.from(await getSecret())).toEqual(Array.from(first));
	});

	test('a damaged secret file is an error, not a silent new secret', async () => {
		delete process.env.YABUS_JWT_SECRET;
		process.env.YABUS_DATA_DIR = root;
		allowDevSecret(true);
		await writeFile(join(root, '.jwt-secret'), 'short\n');
		await expect(getSecret()).rejects.toThrow('at least 32 bytes');
		expect((await readFile(join(root, '.jwt-secret'), 'utf8')).trim()).toBe('short');
	});

	test('a failure is not cached', async () => {
		process.env.YABUS_JWT_SECRET = 'not base64!!';
		await expect(getSecret()).rejects.toThrow();
		process.env.YABUS_JWT_SECRET = Buffer.alloc(32, 3).toString('base64');
		expect((await getSecret())[0]).toBe(3);
	});
});
