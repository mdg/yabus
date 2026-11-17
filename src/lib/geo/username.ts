/**
 * User names. Shared by the server (sign-up, lookups) and the browser (the sign-up form), so
 * both apply exactly the same rules.
 *
 * Lowercase only, so a name is the same in the URL, on disk and in a token, and can never
 * collide on a case-insensitive file system.
 */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export const USERNAME_HELP =
	'Use 3 to 32 lowercase letters, digits, "-" or "_", starting with a letter or digit.';

/** Names nobody can sign up with, mostly to prevent impersonation and confusing addresses. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
	'admin',
	'administrator',
	'api',
	'help',
	'login',
	'logout',
	'moderator',
	'new',
	'null',
	'root',
	'settings',
	'signin',
	'signup',
	'staff',
	'support',
	'system',
	'undefined',
	'user',
	'users',
	'www',
	'yabus'
]);

/** An error message for a name that cannot be used to sign up, or null when it is fine. */
export function validateUsername(name: string): string | null {
	if (!USERNAME_RE.test(name)) return USERNAME_HELP;
	if (RESERVED_USERNAMES.has(name)) return 'That name is reserved.';
	return null;
}
