import { error, redirect } from '@sveltejs/kit';
import { ROUTE_NUMBER_RE } from '#lib/geo/route.ts';
import { username } from '#lib/identity.ts';
import { getLocalRoutes } from '#lib/store/localRoutes.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (!ROUTE_NUMBER_RE.test(params.routeNumber)) error(404, 'No such route');
	// Only the owner edits, and only routes that are in their localStorage. Everything else is
	// shown read-only.
	if (params.username !== username || !getLocalRoutes().has(params.routeNumber)) {
		redirect(307, `/u/${encodeURIComponent(params.username)}/${encodeURIComponent(params.routeNumber)}`);
	}
	return { routeNumber: params.routeNumber };
};
