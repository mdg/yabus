import { createRateLimiter, type RateLimiter } from './rateLimit.ts';
import { getSecret, signToken, type TokenOptions } from './jwt.ts';
import { StorageError } from './storage.ts';
import { createUser, type UserRecord } from './users.ts';

export interface SignUpLimits {
	/** Every sign-up attempt, good or bad, so guessing names cannot be done without limit. */
	attempts: RateLimiter;
	/** Successful sign-ups only. */
	successes: RateLimiter;
	maxUsers: number;
}

export interface SignUpResult {
	token: string;
	expiresAt: Date;
	user: Pick<UserRecord, 'userId' | 'username'>;
}

const HOUR = 60 * 60 * 1000;

function intFromEnv(name: string, fallback: number): number {
	const n = Number(process.env[name]);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

let defaults: SignUpLimits | null = null;

/** The limits the running server uses: 5 sign-ups an hour and 1000 users, both configurable. */
export function defaultSignUpLimits(): SignUpLimits {
	defaults ??= {
		attempts: createRateLimiter({ limit: 30, windowMs: HOUR }),
		successes: createRateLimiter({
			limit: intFromEnv('YABUS_SIGNUPS_PER_HOUR', 5),
			windowMs: HOUR
		}),
		maxUsers: intFromEnv('YABUS_MAX_USERS', 1000)
	};
	return defaults;
}

/**
 * Signs a new user up and returns their token. `clientKey` identifies the caller for rate
 * limiting (their address).
 *
 * Errors (all `StorageError`): 400 invalid or reserved name or a bad request, 409 name taken,
 * 429 too many sign-ups (with `Retry-After`), 503 user cap reached.
 */
export async function signUp(
	username: unknown,
	clientKey: string,
	limits: SignUpLimits = defaultSignUpLimits(),
	opts: TokenOptions = {}
): Promise<SignUpResult> {
	for (const limiter of [limits.attempts, limits.successes]) {
		if (limiter.isLimited(clientKey)) {
			throw new StorageError(429, 'Too many sign-ups right now. Try again later.', {
				'retry-after': String(limiter.retryAfterSeconds(clientKey))
			});
		}
	}
	limits.attempts.hit(clientKey);

	if (typeof username !== 'string') throw new StorageError(400, 'A user name is required.');

	// Get the secret before creating anything, so a missing secret cannot leave a claimed name
	// with no token.
	const secret = opts.secret ?? (await getSecret());

	const user = await createUser(username, { maxUsers: limits.maxUsers });
	limits.successes.hit(clientKey);

	const { token, expiresAt } = await signToken(user, { ...opts, secret });
	return { token, expiresAt, user: { userId: user.userId, username: user.username } };
}
