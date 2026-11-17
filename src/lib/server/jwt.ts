import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jwtVerify, SignJWT } from 'jose';
import { ulid } from 'ulid';
import { USERNAME_RE } from '#lib/geo/username.ts';
import { dataDir, ULID_RE, unauthorized } from './storage.ts';
import type { UserRecord } from './users.ts';

/** A token is valid for one year (and the client renews it well before then). */
export const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

const ISSUER = 'yabus';
const AUDIENCE = 'yabus';
const MIN_SECRET_BYTES = 32;
const CLOCK_TOLERANCE_SECONDS = 30;

// ---------------------------------------------------------------------------------------------
// The signing secret
// ---------------------------------------------------------------------------------------------

function decodeSecret(text: string, where: string): Uint8Array {
	if (!/^[A-Za-z0-9+/_-]+=*$/.test(text)) throw new Error(`${where} is not valid base64`);
	const bytes = Buffer.from(text, 'base64');
	if (bytes.length < MIN_SECRET_BYTES) {
		throw new Error(`${where} must be at least ${MIN_SECRET_BYTES} bytes (base64 encoded)`);
	}
	return new Uint8Array(bytes);
}

/**
 * Whether a made-up development secret may be used when `YABUS_JWT_SECRET` is not set.
 *
 * This is off unless the app turns it on (src/hooks.server.ts does, only for `vite dev`), so the
 * default is secure: no configured secret means no secret. It is deliberately NOT decided from
 * `NODE_ENV`: the production build inlines `process.env.NODE_ENV` and strips such checks out of
 * the server bundle, so a `NODE_ENV` test silently stops working there.
 */
let devSecretAllowed = false;

export function allowDevSecret(allowed: boolean): void {
	devSecretAllowed = allowed;
}

async function loadSecret(): Promise<Uint8Array> {
	const fromEnv = process.env.YABUS_JWT_SECRET;
	if (fromEnv) return decodeSecret(fromEnv.trim(), 'YABUS_JWT_SECRET');

	if (!devSecretAllowed) {
		throw new Error(
			'YABUS_JWT_SECRET must be set. Generate one with: openssl rand -base64 32. ' +
				'Back it up, because changing it invalidates every token.'
		);
	}

	// Development: a random secret, created once and kept so tokens survive restarts.
	const file = join(dataDir(), '.jwt-secret');
	const read = async () => decodeSecret((await readFile(file, 'utf8')).trim(), file);
	try {
		return await read();
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
	await mkdir(dataDir(), { recursive: true });
	try {
		await writeFile(file, randomBytes(32).toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; // someone else just made it
	}
	return read();
}

let secretPromise: Promise<Uint8Array> | null = null;

/** The signing secret, loaded once. Throws if none is configured and a dev secret is not allowed. */
export function getSecret(): Promise<Uint8Array> {
	secretPromise ??= loadSecret();
	secretPromise.catch(() => (secretPromise = null)); // do not cache a failure
	return secretPromise;
}

/** For tests: forget the loaded secret. */
export function resetSecretCache(): void {
	secretPromise = null;
}

// ---------------------------------------------------------------------------------------------
// Signing and verifying
// ---------------------------------------------------------------------------------------------

export interface TokenOptions {
	/** Defaults to the configured secret. Tests pass their own. */
	secret?: Uint8Array;
	/** Defaults to the current time. Tests pass their own. */
	now?: Date;
}

export interface TokenClaims {
	userId: string;
	username: string;
	/** Seconds since the epoch. */
	iat: number;
	exp: number;
	jti: string | undefined;
}

/** Signs a token for a user. HS256, one year, a fresh `jti` each time. */
export async function signToken(
	user: Pick<UserRecord, 'userId' | 'username'>,
	opts: TokenOptions = {}
): Promise<{ token: string; expiresAt: Date }> {
	const secret = opts.secret ?? (await getSecret());
	const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
	const exp = iat + TOKEN_LIFETIME_SECONDS;
	const token = await new SignJWT({ username: user.username })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setSubject(user.userId)
		.setIssuedAt(iat)
		.setExpirationTime(exp)
		.setJti(ulid())
		.sign(secret);
	return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Checks a token's signature and claims. Throws a 401 `StorageError` for anything wrong.
 *
 * Only HS256 is accepted (so `none` and algorithm-confusion tricks fail), `exp` must be in the
 * future, `iss` and `aud` must match, and `sub` and `username` must be well-formed. This does
 * not look the user up; `authenticate` does that.
 */
export async function verifyToken(token: string, opts: TokenOptions = {}): Promise<TokenClaims> {
	const secret = opts.secret ?? (await getSecret());
	const invalid = () => unauthorized('Invalid or expired token');

	let payload;
	try {
		({ payload } = await jwtVerify(token, secret, {
			algorithms: ['HS256'],
			issuer: ISSUER,
			audience: AUDIENCE,
			clockTolerance: CLOCK_TOLERANCE_SECONDS,
			requiredClaims: ['sub', 'iat', 'exp'],
			currentDate: opts.now
		}));
	} catch {
		throw invalid();
	}

	const { sub, username, iat, exp, jti } = payload;
	if (
		typeof sub !== 'string' ||
		!ULID_RE.test(sub) ||
		typeof username !== 'string' ||
		!USERNAME_RE.test(username) ||
		typeof iat !== 'number' ||
		typeof exp !== 'number'
	) {
		throw invalid();
	}
	return { userId: sub, username, iat, exp, jti: typeof jti === 'string' ? jti : undefined };
}
