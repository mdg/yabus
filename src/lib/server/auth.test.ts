import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, authorizeRequest } from './auth.ts';
import { signToken } from './jwt.ts';
import { StorageError } from './storage.ts';
import { createUser } from './users.ts';

const secret = new Uint8Array(32).fill(7);
let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'yabus-auth-'));
	process.env.YABUS_DATA_DIR = root;
});
afterAll(async () => {
	delete process.env.YABUS_DATA_DIR;
	await rm(root, { recursive: true, force: true });
});

const withToken = (token: string) =>
	new Request('http://localhost/api/x', { method: 'PUT', headers: { authorization: `Bearer ${token}` } });

/** The status of the StorageError thrown, or null if nothing was thrown. */
const outcome = async (p: Promise<unknown>) => {
	try {
		await p;
		return null;
	} catch (e) {
		if (e instanceof StorageError) return { status: e.status, headers: e.headers };
		throw e;
	}
};

describe('authorizeRequest', () => {
	test('a valid token for the user in the path passes and returns the user', async () => {
		const alice = await createUser('alice');
		const { token } = await signToken(alice, { secret });
		const user = await authorizeRequest(withToken(token), 'alice', { secret });
		expect(user.userId).toBe(alice.userId);
		expect(user.username).toBe('alice');
	});

	test('the user name in the path is compared case-insensitively', async () => {
		const bob = await createUser('bobby');
		const { token } = await signToken(bob, { secret });
		expect((await authorizeRequest(withToken(token), 'BOBBY', { secret })).username).toBe('bobby');
	});

	test('a valid token for another user’s path is a 403', async () => {
		const carol = await createUser('carol');
		await createUser('dave');
		const { token } = await signToken(carol, { secret });
		expect((await outcome(authorizeRequest(withToken(token), 'dave', { secret })))?.status).toBe(403);
	});

	test('no header, wrong scheme, empty or garbage tokens are a 401 with WWW-Authenticate', async () => {
		const requests = [
			new Request('http://localhost/x'),
			new Request('http://localhost/x', { headers: { authorization: 'Basic abc' } }),
			new Request('http://localhost/x', { headers: { authorization: 'Bearer ' } }),
			new Request('http://localhost/x', { headers: { authorization: 'Bearer' } }),
			new Request('http://localhost/x', { headers: { authorization: 'Bearer not a token' } }),
			withToken('garbage'),
			withToken('a.b.c')
		];
		for (const request of requests) {
			const result = await outcome(authorizeRequest(request, 'alice', { secret }));
			expect(result?.status).toBe(401);
			expect(result?.headers['www-authenticate']).toBe('Bearer');
		}
	});

	test('a token longer than the limit is refused before it is parsed', async () => {
		expect((await outcome(authorizeRequest(withToken('a'.repeat(5000)), 'alice', { secret })))?.status).toBe(401);
	});

	test('a token for a user that does not exist is a 401', async () => {
		const { token } = await signToken({ userId: '01J8ZQ0000000000000000000A', username: 'ghost' }, { secret });
		expect((await outcome(authenticate(withToken(token), { secret })))?.status).toBe(401);
	});

	test('a token whose user ID does not match the record is a 401', async () => {
		// the name exists, but belongs to a different user than the token says
		await createUser('erin');
		const { token } = await signToken({ userId: '01J8ZQ0000000000000000000B', username: 'erin' }, { secret });
		expect((await outcome(authenticate(withToken(token), { secret })))?.status).toBe(401);
	});

	test('an expired token is a 401', async () => {
		const frank = await createUser('frank');
		const { token } = await signToken(frank, { secret, now: new Date('2020-01-01T00:00:00Z') });
		expect((await outcome(authenticate(withToken(token), { secret })))?.status).toBe(401);
	});

	test('a token signed with another secret is a 401', async () => {
		const gina = await createUser('gina');
		const { token } = await signToken(gina, { secret: new Uint8Array(32).fill(1) });
		expect((await outcome(authenticate(withToken(token), { secret })))?.status).toBe(401);
	});
});

describe('revocation with tokensValidAfter', () => {
	async function setCutoff(username: string, tokensValidAfter: string | null) {
		const file = join(root, username, 'user.json');
		const record = JSON.parse(await readFile(file, 'utf8'));
		await writeFile(file, JSON.stringify({ ...record, tokensValidAfter }));
	}

	test('tokens issued before the cutoff are rejected, later ones are not', async () => {
		const hank = await createUser('hank');
		const hourAgo = new Date(Date.now() - 3_600_000);
		const old = await signToken(hank, { secret, now: hourAgo });
		const fresh = await signToken(hank, { secret });

		await setCutoff('hank', new Date(Date.now() - 60_000).toISOString()); // revoked a minute ago
		expect((await outcome(authenticate(withToken(old.token), { secret })))?.status).toBe(401);
		expect(await outcome(authenticate(withToken(fresh.token), { secret }))).toBeNull();
	});

	test('a cutoff in the future rejects every token so far', async () => {
		const ivy = await createUser('ivy');
		const { token } = await signToken(ivy, { secret });
		await setCutoff('ivy', new Date(Date.now() + 3_600_000).toISOString());
		expect((await outcome(authenticate(withToken(token), { secret })))?.status).toBe(401);
	});

	test('a token issued in the same second as the cutoff still works', async () => {
		const jack = await createUser('jack');
		const now = new Date();
		const { token } = await signToken(jack, { secret, now });
		await setCutoff('jack', now.toISOString()); // iat is rounded down, the cutoff is not
		expect(await outcome(authenticate(withToken(token), { secret }))).toBeNull();
	});

	test('no cutoff means no revocation', async () => {
		const kate = await createUser('kate');
		const { token } = await signToken(kate, { secret });
		expect(await outcome(authenticate(withToken(token), { secret }))).toBeNull();
	});
});
