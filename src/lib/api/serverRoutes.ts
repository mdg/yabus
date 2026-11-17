import { parseRoute } from '#lib/geo/route.ts';
import type { RouteCollection } from '#lib/geo/types.ts';

/**
 * The route numbers a user has on the server (public read of the list endpoint).
 * Best effort: when the server cannot be reached this returns an empty list, so the app keeps
 * working offline and numbering falls back to what is in `localStorage`.
 */
export async function fetchServerRouteNumbers(
	username: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<string[]> {
	try {
		const res = await fetchFn(`/api/users/${encodeURIComponent(username)}/routes`);
		if (!res.ok) return [];
		const data: unknown = await res.json();
		if (!Array.isArray(data)) return [];
		return data
			.map((item) => (item as { number?: unknown } | null)?.number)
			.filter((n): n is string => typeof n === 'string');
	} catch {
		return [];
	}
}

/**
 * Every route a user has on the server (public reads): the list, then each route. Best effort:
 * routes that cannot be fetched or do not validate are skipped, and an unreachable server gives
 * an empty list.
 */
export async function fetchServerRoutes(
	username: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<RouteCollection[]> {
	const numbers = await fetchServerRouteNumbers(username, fetchFn);
	const routes = await Promise.all(
		numbers.map(async (number): Promise<RouteCollection | null> => {
			try {
				const res = await fetchFn(
					`/api/users/${encodeURIComponent(username)}/routes/${encodeURIComponent(number)}`
				);
				if (!res.ok) return null;
				const parsed = parseRoute(await res.json(), number);
				return parsed.ok ? parsed.route : null;
			} catch {
				return null;
			}
		})
	);
	return routes.filter((r): r is RouteCollection => r !== null);
}
