import { StorageError } from './storage.ts';

/**
 * Turns an error from the storage, auth or sign-up code into a JSON response with its status and
 * any headers it carries (`WWW-Authenticate` on a 401, `Retry-After` on a 429). Anything else is
 * a real bug and is rethrown.
 */
export function toResponse(e: unknown): Response {
	if (e instanceof StorageError) {
		return new Response(JSON.stringify({ message: e.message }), {
			status: e.status,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...e.headers }
		});
	}
	throw e;
}

/** Reads a request body as JSON, refusing anything bigger than `maxBytes` before buffering it all. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
	const tooLarge = () => new StorageError(413, 'Request too large');
	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge();

	const chunks: Uint8Array[] = [];
	let total = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new StorageError(400, 'Body is not valid JSON');
	}
}

/** The address used to rate limit a caller. Falls back to a shared key if it cannot be found. */
export function clientKey(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch {
		return 'unknown';
	}
}
