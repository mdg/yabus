import { json } from '@sveltejs/kit';
import { toResponse } from '#lib/server/api.ts';
import { authenticate } from '#lib/server/auth.ts';
import { signToken } from '#lib/server/jwt.ts';
import type { RequestHandler } from './$types';

/**
 * Renew: `POST` with a valid token, and get a fresh one (another year) for the same user. An
 * invalid or already expired token is a 401; once a token has expired there is no way back in.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { user } = await authenticate(request);
		const { token, expiresAt } = await signToken(user);
		return json(
			{
				token,
				expiresAt: expiresAt.toISOString(),
				user: { userId: user.userId, username: user.username }
			},
			{ headers: { 'cache-control': 'no-store' } }
		);
	} catch (e) {
		return toResponse(e);
	}
};
