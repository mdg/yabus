import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, username } from '#lib/server/identity.ts';
import { createSession, isValidSession } from '#lib/server/storage.ts';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Only real page loads issue sessions: not /api calls, not favicon or other asset requests. */
function isPageRequest(event: RequestEvent): boolean {
	return (
		event.request.method === 'GET' &&
		!event.url.pathname.startsWith('/api/') &&
		(event.request.headers.get('accept') ?? '').includes('text/html')
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	let sessionId = event.cookies.get(SESSION_COOKIE);

	// No usable session (first visit, expired after 30 days, cleared, or its directory is gone):
	// generate a new ULID and a new session directory. Existing sessions are never touched.
	if (isPageRequest(event) && !(sessionId && (await isValidSession(username, sessionId)))) {
		sessionId = await createSession(username);
		event.cookies.set(SESSION_COOKIE, sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: THIRTY_DAYS
			// `secure` is left to SvelteKit's default: on, except for http://localhost.
		});
	}

	event.locals.sessionId = sessionId;
	return resolve(event);
};
