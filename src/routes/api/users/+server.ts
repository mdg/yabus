import { json } from '@sveltejs/kit';
import { clientKey, readJsonBody, toResponse } from '#lib/server/api.ts';
import { signUp } from '#lib/server/signup.ts';
import type { RequestHandler } from './$types';

/**
 * Sign up: `POST { "username": "..." }`. Needs no token, because this is how a person gets one.
 * Responds 201 with `{ token, expiresAt, user: { userId, username } }`.
 *
 * It only ever creates a NEW user. A name that is taken is a 409, so this can never be used to
 * get a token for someone else's account.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		const body = await readJsonBody(request, 1024);
		const username = typeof body === 'object' && body !== null ? (body as { username?: unknown }).username : undefined;
		const result = await signUp(username, clientKey(getClientAddress));
		return json(
			{ token: result.token, expiresAt: result.expiresAt.toISOString(), user: result.user },
			{ status: 201, headers: { 'cache-control': 'no-store' } }
		);
	} catch (e) {
		return toResponse(e);
	}
};
