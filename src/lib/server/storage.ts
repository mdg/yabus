import { randomBytes } from 'node:crypto';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseRoute, ROUTE_NUMBER_RE } from '#lib/geo/route.ts';
import type { RouteCollection } from '#lib/geo/types.ts';

/** A ULID is always 26 Crockford base32 characters. */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** An error that maps to an HTTP status. Kept free of SvelteKit so it is easy to test. */
export class StorageError extends Error {
	constructor(
		public status: number,
		message: string,
		/** Extra response headers, for example `WWW-Authenticate` on a 401. */
		public headers: Record<string, string> = {}
	) {
		super(message);
	}
}

/** A 401. The `WWW-Authenticate` header tells clients that a bearer token is what is missing. */
export function unauthorized(message: string): StorageError {
	return new StorageError(401, message, { 'www-authenticate': 'Bearer' });
}

/** Root of all server-side data. Read on every call so tests can point it elsewhere. */
export function dataDir(): string {
	return process.env.YABUS_DATA_DIR ?? resolve(process.cwd(), 'data');
}

export function checkRouteNumber(routeNumber: string): void {
	if (!ROUTE_NUMBER_RE.test(routeNumber)) throw new StorageError(400, 'invalid route number');
}

function isEnoent(e: unknown): boolean {
	return (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
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
