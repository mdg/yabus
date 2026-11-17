import { ROUTE_NUMBER_RE } from './route.ts';

/**
 * The number for a new (or duplicated) route: the highest integer route number in `taken`
 * plus 1, or 1 when there are none. Non-integer numbers like `42X` are ignored for the
 * "highest" part. If the result is somehow already taken, keep going to the next unused
 * integer.
 *
 * `taken` should include the user's routes in `localStorage` AND on the server, so a
 * replicating `PUT` can never overwrite a server-only route.
 */
export function nextRouteNumber(taken: Iterable<string>): string {
	const all = [...taken];
	const lower = new Set(all.map((t) => t.toLowerCase()));
	let highest = 0;
	for (const t of all) {
		// At most 9 digits, so the arithmetic below stays exact.
		if (/^\d{1,9}$/.test(t)) highest = Math.max(highest, Number(t));
	}
	let n = highest + 1;
	while (lower.has(String(n))) n++;
	return String(n);
}

export const ROUTE_NUMBER_HELP =
	'Use 1 to 32 letters, digits, "-" or "_", starting with a letter or digit.';

/**
 * Checks a new route number for a rename. Returns an error message, or null when it is fine.
 * Other routes are compared case-insensitively, so `42x` cannot sit beside `42X` and collide
 * on a case-insensitive file system. The route's own current number is not a conflict.
 */
export function validateRouteNumber(
	candidate: string,
	current: string,
	taken: Iterable<string>
): string | null {
	if (!ROUTE_NUMBER_RE.test(candidate)) return ROUTE_NUMBER_HELP;
	if (candidate === current) return null;
	const lower = candidate.toLowerCase();
	for (const t of taken) {
		if (t !== current && t.toLowerCase() === lower) return `Route ${t} already exists.`;
	}
	return null;
}
