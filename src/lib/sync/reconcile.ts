import { fetchServerRoutes } from '#lib/api/serverRoutes.ts';
import type { RouteCollection } from '#lib/geo/types.ts';
import type { Replicator } from './replicator.ts';

const numberOf = (route: RouteCollection) => route.features[0].properties.number;

/**
 * Makes the server match this browser's routes, once per page load. `localStorage` wins: a local
 * route the server does not have, or has a different copy of, is sent to the server and
 * overwrites it.
 *
 * Routes that exist only on the server are left alone. They are never copied into
 * `localStorage` and never deleted from the server here.
 *
 * Both sides are compared as they come out of `parseRoute`, which builds objects in a fixed key
 * order, so comparing their JSON is a reliable "same route" test. Returns the numbers sent.
 */
export async function reconcile(deps: {
	username: string;
	local: RouteCollection[];
	replicator: Pick<Replicator, 'push'>;
	fetchFn?: typeof fetch;
}): Promise<string[]> {
	const server = await fetchServerRoutes(deps.username, deps.fetchFn);
	const serverCopies = new Map(server.map((r) => [numberOf(r), JSON.stringify(r)]));

	const sent: string[] = [];
	for (const route of deps.local) {
		if (serverCopies.get(numberOf(route)) === JSON.stringify(route)) continue;
		sent.push(numberOf(route));
		void deps.replicator.push(route);
	}
	return sent;
}
