import { fetchServerRouteNumbers } from '#lib/api/serverRoutes.ts';
import { username } from '#lib/identity.ts';
import { getLocalRoutes } from './localRoutes.ts';

/** Every route number the current user has, in `localStorage` or on the server. */
export async function takenRouteNumbers(): Promise<string[]> {
	const server = await fetchServerRouteNumbers(username);
	return [...new Set([...getLocalRoutes().list(), ...server])];
}
