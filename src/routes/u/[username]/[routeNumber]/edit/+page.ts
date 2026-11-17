import { error, redirect } from '@sveltejs/kit';
import { ROUTE_NUMBER_RE } from '#lib/geo/route.ts';
import { username } from '#lib/identity.ts';
import { getLocalRoutes } from '#lib/store/localRoutes.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (!ROUTE_NUMBER_RE.test(params.routeNumber)) error(404, 'No such route');
	// Only the owner edits, and only routes that are in their localStorage. The read-only view
	// arrives in a later milestone; until then everything else goes back to the route list.
	if (params.username !== username || !getLocalRoutes().has(params.routeNumber)) {
		redirect(307, '/');
	}
	return { routeNumber: params.routeNumber };
};
