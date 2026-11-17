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
