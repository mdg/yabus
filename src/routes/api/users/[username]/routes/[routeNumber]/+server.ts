import { error, json } from '@sveltejs/kit';
import { parseRoute } from '#lib/geo/route.ts';
import { toHttpError } from '#lib/server/api.ts';
import {
	authorizeSession,
	checkRouteNumber,
	deleteRoute,
	findReadDir,
	readRoute,
	writeRoute
} from '#lib/server/storage.ts';
import { SESSION_COOKIE } from '#lib/server/identity.ts';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 1_000_000;

/** A route's GeoJSON (public). Reads the first matching session directory. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		checkRouteNumber(params.routeNumber);
		const dir = await findReadDir(params.username);
		const route = dir ? await readRoute(dir, params.routeNumber) : null;
		if (!route) error(404, 'route not found');
		return json(route, { headers: { 'content-type': 'application/geo+json' } });
	} catch (e) {
		toHttpError(e);
	}
};

/** Creates or replaces a route in the caller's own session directory. */
export const PUT: RequestHandler = async ({ params, request, cookies }) => {
	try {
		// Authorize first, before reading the body or touching any file.
		const dir = await authorizeSession(params.username, cookies.get(SESSION_COOKIE));
		checkRouteNumber(params.routeNumber);

		const declared = Number(request.headers.get('content-length') ?? 0);
		if (declared > MAX_BODY_BYTES) error(413, 'route too large');
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) error(413, 'route too large');

		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			error(400, 'body is not valid JSON');
		}
		const parsed = parseRoute(body, params.routeNumber);
		if (!parsed.ok) error(422, parsed.errors.join('; '));

		await writeRoute(dir, params.routeNumber, parsed.route);
		return new Response(null, { status: 204 });
	} catch (e) {
		toHttpError(e);
	}
};

/** Deletes a route from the caller's own session directory. Missing routes are not an error. */
export const DELETE: RequestHandler = async ({ params, cookies }) => {
	try {
		const dir = await authorizeSession(params.username, cookies.get(SESSION_COOKIE));
		await deleteRoute(dir, params.routeNumber);
		return new Response(null, { status: 204 });
	} catch (e) {
		toHttpError(e);
	}
};
