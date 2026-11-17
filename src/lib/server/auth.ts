import { StorageError, unauthorized } from './storage.ts';
import { verifyToken, type TokenClaims, type TokenOptions } from './jwt.ts';
import { getUser, type UserRecord } from './users.ts';

const BEARER_RE = /^Bearer ([A-Za-z0-9._~+/=-]{1,4096})$/;

/**
 * Works out who is calling from the `Authorization: Bearer <token>` header. Checks, in order:
 * the header is well-formed, the token verifies, the user exists and the record's user ID equals
 * the token's `sub`, and the token was not issued before the user's `tokensValidAfter`.
 * Anything wrong is a 401.
 */
export async function authenticate(
	request: Request,
	opts: TokenOptions = {}
): Promise<{ user: UserRecord; claims: TokenClaims }> {
	const match = BEARER_RE.exec(request.headers.get('authorization') ?? '');
	if (!match) throw unauthorized('Sign in required');

	const claims = await verifyToken(match[1], opts);

	// The token names the directory to check; the record must agree with the token's `sub`.
	// This ties a validly signed token to the real user, so a token for a name that was deleted
	// and then claimed by someone else does not work.
	const user = await getUser(claims.username);
	if (!user || user.userId !== claims.userId) throw unauthorized('Invalid or expired token');

	if (user.tokensValidAfter !== null) {
		// Whole seconds on both sides, so a token issued in the same second as a revocation is
		// not rejected by rounding.
		const cutoff = Math.floor(Date.parse(user.tokensValidAfter) / 1000);
		if (claims.iat < cutoff) throw unauthorized('This token has been revoked');
	}
	return { user, claims };
}

/**
 * The check every server write must pass, with no exceptions. Authenticates the caller, then
 * requires that the user name in the URL is theirs (a 403 otherwise).
 *
 * Returns the user. Write only into `userDir(user.username)`: the directory comes from the
 * verified record, never from the URL or the body.
 */
export async function authorizeRequest(
	request: Request,
	usernameFromPath: string,
	opts: TokenOptions = {}
): Promise<UserRecord> {
	const { user } = await authenticate(request, opts);
	if (usernameFromPath.toLowerCase() !== user.username) {
		throw new StorageError(403, 'You can only change your own routes');
	}
	return user;
}
