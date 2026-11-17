import { building, dev } from '$app/env';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { allowDevSecret, getSecret } from '#lib/server/jwt.ts';

/** The cookie the old session scheme used. Sessions are gone; see plan/jwt.md. */
const LEGACY_SESSION_COOKIE = 'sessionId';

// Only the dev server may invent a signing secret. Everything else must configure one.
allowDevSecret(dev);

/**
 * Loads the token signing secret when the server initializes, so a missing `YABUS_JWT_SECRET`
 * fails loudly instead of on the first sign-up. Skipped while SvelteKit is building.
 */
export const init: ServerInit = async () => {
	if (!building) await getSecret();
};

/** A real page load, not an /api call or an asset request such as the favicon. */
function isPageRequest(event: RequestEvent): boolean {
	return (
		event.request.method === 'GET' &&
		!event.url.pathname.startsWith('/api/') &&
		(event.request.headers.get('accept') ?? '').includes('text/html')
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	// Clear the old session cookie the first time a page request carries it. Nothing reads it any
	// more, and this stops browsers from sending it forever.
	if (isPageRequest(event) && event.cookies.get(LEGACY_SESSION_COOKIE) !== undefined) {
		event.cookies.delete(LEGACY_SESSION_COOKIE, { path: '/' });
	}
	return resolve(event);
};
