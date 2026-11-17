import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ulid } from 'ulid';
import { parseRoute, ROUTE_NUMBER_RE, USERNAME_RE } from '#lib/geo/route.ts';
import type { RouteCollection } from '#lib/geo/types.ts';

/** A ULID is always 26 Crockford base32 characters. */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** An error that maps to an HTTP status. Kept free of SvelteKit so it is easy to test. */
export class StorageError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/** Root of all server-side data. Read on every call so tests can point it elsewhere. */
export function dataDir(): string {
	return process.env.YABUS_DATA_DIR ?? resolve(process.cwd(), 'data');
}

function checkUsername(username: string): void {
	if (!USERNAME_RE.test(username)) throw new StorageError(400, 'invalid username');
}

export function checkRouteNumber(routeNumber: string): void {
	if (!ROUTE_NUMBER_RE.test(routeNumber)) throw new StorageError(400, 'invalid route number');
}

/** Directory name for a session: `{username}-{sessionId}`. Both parts are validated. */
function sessionDirPath(username: string, sessionId: string): string {
	checkUsername(username);
	if (!ULID_RE.test(sessionId)) throw new StorageError(403, 'invalid session');
	return join(dataDir(), `${username}-${sessionId}`);
}

function isEnoent(e: unknown): boolean {
	return (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Creates a NEW session: a new ULID and a new directory `data/{username}-{sessionId}/`
 * containing a write-once `session.json`. Nothing existing is ever overwritten; on the
 * (practically impossible) chance the directory exists, another ULID is generated.
 *
 * Only the session issuing code (src/hooks.server.ts) may call this.
 */
export async function createSession(username: string): Promise<string> {
	checkUsername(username);
	await mkdir(dataDir(), { recursive: true });
	for (let attempt = 0; attempt < 5; attempt++) {
		const sessionId = ulid();
		const dir = sessionDirPath(username, sessionId);
		try {
			await mkdir(dir); // not recursive: fails with EEXIST if it already exists
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
			throw e;
		}
		// 'wx' fails instead of overwriting an existing file.
		await writeFile(join(dir, 'session.json'), JSON.stringify({ sessionId }) + '\n', {
			flag: 'wx'
		});
		return sessionId;
	}
	throw new Error('could not create a unique session directory');
}

/**
 * The authorization check for every server write. Returns the session's own directory.
 *
 * The cookie must be a well-formed ULID, `data/{username}-{sessionId}/` must exist, and the
 * `sessionId` in its `session.json` must equal the cookie. Anything else is a 403, before any
 * file is touched. The directory is derived only from the username and the cookie.
 */
export async function authorizeSession(
	username: string,
	sessionId: string | undefined
): Promise<string> {
	if (!sessionId) throw new StorageError(403, 'no session');
	const dir = sessionDirPath(username, sessionId);
	let stored: unknown;
	try {
		stored = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')).sessionId;
	} catch {
		throw new StorageError(403, 'invalid session');
	}
	if (typeof stored !== 'string') throw new StorageError(403, 'invalid session');
	const a = Buffer.from(stored);
	const b = Buffer.from(sessionId);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new StorageError(403, 'invalid session');
	}
	return dir;
}

/** Whether a session cookie value is currently valid for the username. */
export async function isValidSession(username: string, sessionId: string): Promise<boolean> {
	try {
		await authorizeSession(username, sessionId);
		return true;
	} catch (e) {
		if (e instanceof StorageError) return false;
		throw e;
	}
}

/**
 * The directory that reads use for a username: the FIRST matching session directory in
 * sorted order. ULIDs sort by creation time, so that is the oldest session. Several sessions
 * can exist for one username; for now that overlap is accepted.
 *
 * Matches the exact pattern `{username}-{26-char ULID}`, not a loose glob, so `al` never
 * matches the directories of `al-bob`.
 */
export async function findReadDir(username: string): Promise<string | null> {
	checkUsername(username);
	let entries;
	try {
		entries = await readdir(dataDir(), { withFileTypes: true });
	} catch (e) {
		if (isEnoent(e)) return null;
		throw e;
	}
	const pattern = new RegExp(`^${username}-[0-9A-HJKMNP-TV-Z]{26}$`);
	const names = entries
		.filter((e) => e.isDirectory() && pattern.test(e.name))
		.map((e) => e.name)
		.sort();
	return names.length > 0 ? join(dataDir(), names[0]) : null;
}

const ROUTE_FILE_RE = /^([A-Za-z0-9][A-Za-z0-9_-]{0,31})\.geojson$/;

export async function listRouteNumbers(dir: string): Promise<string[]> {
	const names = await readdir(dir);
	return names
		.map((n) => ROUTE_FILE_RE.exec(n)?.[1])
		.filter((n): n is string => n !== undefined)
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Returns null when the route does not exist. */
export async function readRoute(dir: string, routeNumber: string): Promise<RouteCollection | null> {
	checkRouteNumber(routeNumber);
	let text: string;
	try {
		text = await readFile(join(dir, `${routeNumber}.geojson`), 'utf8');
	} catch (e) {
		if (isEnoent(e)) return null;
		throw e;
	}
	const parsed = parseRoute(JSON.parse(text), routeNumber);
	if (!parsed.ok) throw new Error(`stored route ${routeNumber} is invalid: ${parsed.errors[0]}`);
	return parsed.route;
}

/** Atomic write: a temp file in the same directory, then rename over the target. */
export async function writeRoute(
	dir: string,
	routeNumber: string,
	route: RouteCollection
): Promise<void> {
	checkRouteNumber(routeNumber);
	const tmp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
	try {
		await writeFile(tmp, JSON.stringify(route) + '\n', { flag: 'wx' });
		await rename(tmp, join(dir, `${routeNumber}.geojson`));
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

/** Deleting a route that does not exist is not an error. */
export async function deleteRoute(dir: string, routeNumber: string): Promise<void> {
	checkRouteNumber(routeNumber);
	await rm(join(dir, `${routeNumber}.geojson`), { force: true });
}
