import { error, redirect } from '@sveltejs/kit';
import { ROUTE_NUMBER_RE } from '#lib/geo/route.ts';
import { username } from '#lib/identity.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (!ROUTE_NUMBER_RE.test(params.routeNumber)) error(404, 'No such route');
	// Only the owner edits. The read-only view arrives in a later milestone; until then send
	// everyone else home.
	if (params.username !== username) redirect(307, '/');
	return { routeNumber: params.routeNumber };
};
