/**
 * Starts the built server (`bun run start`), but first makes sure the token signing secret is
 * configured, so a missing `YABUS_JWT_SECRET` stops the server from starting at all.
 *
 *   export YABUS_JWT_SECRET=$(openssl rand -base64 32)   # keep it, and back it up
 *   bun run build && bun run start
 *
 * The secret must stay the same between runs: changing it invalidates every token, and with no
 * password to sign back in with, that locks every user out.
 */
import { getSecret } from '../src/lib/server/jwt.ts';

try {
	await getSecret();
} catch (e) {
	console.error(`\nCannot start: ${(e as Error).message}\n`);
	process.exit(1);
}

await import('../build/index.js');
