import { json } from '@sveltejs/kit';
import { parseRoute } from '#lib/geo/route.ts';
import { readJsonBody, toResponse } from '#lib/server/api.ts';
import { authorizeRequest } from '#lib/server/auth.ts';
import {
	checkRouteNumber,
	deleteRoute,
	readRoute,
	StorageError,
	writeRoute
} from '#lib/server/storage.ts';
import { getUser, userDir } from '#lib/server/users.ts';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 1_000_000;

/** A route's GeoJSON (public). */
export const GET: RequestHandler = async ({ params }) => {
	try {
		checkRouteNumber(params.routeNumber);
		const user = await getUser(params.username);
		const route = user ? await readRoute(userDir(user.username), params.routeNumber) : null;
		if (!route) throw new StorageError(404, 'route not found');
		return json(route, { headers: { 'content-type': 'application/geo+json' } });
	} catch (e) {
		return toResponse(e);
	}
};

/**
 * Creates or replaces a route. Needs `Authorization: Bearer <token>` for the user in the path.
 * Writes only into that user's own directory, taken from the verified record.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		// Authenticate first, before reading the body or touching any file.
		const user = await authorizeRequest(request, params.username);
		checkRouteNumber(params.routeNumber);

		const parsed = parseRoute(await readJsonBody(request, MAX_BODY_BYTES), params.routeNumber);
		if (!parsed.ok) throw new StorageError(422, parsed.errors.join('; '));

		await writeRoute(userDir(user.username), params.routeNumber, parsed.route);
		return new Response(null, { status: 204 });
	} catch (e) {
		return toResponse(e);
	}
};

/** Deletes a route. Same authorization as PUT. Deleting a route that is not there is not an error. */
export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		const user = await authorizeRequest(request, params.username);
		await deleteRoute(userDir(user.username), params.routeNumber);
		return new Response(null, { status: 204 });
	} catch (e) {
		return toResponse(e);
	}
};
