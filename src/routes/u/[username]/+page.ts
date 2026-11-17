import { error } from '@sveltejs/kit';
import { fetchServerRoutes } from '#lib/api/serverRoutes.ts';
import { mergeComposite } from '#lib/geo/composite.ts';
import { USERNAME_RE } from '#lib/geo/route.ts';
import { username } from '#lib/identity.ts';
import { getLocalRoutes } from '#lib/store/localRoutes.ts';
import type { PageLoad } from './$types';

/**
 * The composite view: all of one user's routes. Anyone can look at any user's routes.
 *
 * For the current user, routes in this browser's `localStorage` come first and win over the
 * server's copies (they are the editable ones). Everything else comes from the server and is
 * read-only. For any other user it is the server only.
 */
export const load: PageLoad = async ({ params, fetch }) => {
	if (!USERNAME_RE.test(params.username)) error(404, 'No such user');
	const local = params.username === username ? getLocalRoutes().all() : [];
	const server = await fetchServerRoutes(params.username, fetch);
	return { username: params.username, entries: mergeComposite(local, server) };
};
