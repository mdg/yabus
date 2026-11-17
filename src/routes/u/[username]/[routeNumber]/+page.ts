import { error } from '@sveltejs/kit';
import { parseRoute, ROUTE_NUMBER_RE, USERNAME_RE } from '#lib/geo/route.ts';
import { username } from '#lib/identity.ts';
import { getLocalRoutes } from '#lib/store/localRoutes.ts';
import type { PageLoad } from './$types';

/**
 * The read-only view of one route. Anyone can open it.
 *
 * For the current user, a route in this browser's `localStorage` is used first (it is theirs and
 * editable). Otherwise the route comes from the server and is read-only.
 */
export const load: PageLoad = async ({ params, fetch }) => {
	if (!USERNAME_RE.test(params.username) || !ROUTE_NUMBER_RE.test(params.routeNumber)) {
		error(404, 'No such route');
	}

	const local = params.username === username ? getLocalRoutes().get(params.routeNumber) : null;
	if (local) return { username: params.username, route: local, source: 'local' as const };

	let res: Response;
	try {
		res = await fetch(
			`/api/users/${encodeURIComponent(params.username)}/routes/${encodeURIComponent(params.routeNumber)}`
		);
	} catch {
		error(503, 'Could not reach the server');
	}
	if (!res.ok) error(404, 'No such route');
	const parsed = parseRoute(await res.json(), params.routeNumber);
	if (!parsed.ok) error(404, 'No such route');
	return { username: params.username, route: parsed.route, source: 'server' as const };
};
