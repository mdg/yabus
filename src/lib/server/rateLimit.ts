/**
 * A sliding-window rate limiter kept in memory. Fine for one server process; it does not survive
 * a restart and is not shared between processes.
 */
export interface RateLimiter {
	/** True when `key` has already used up its allowance in the current window. */
	isLimited(key: string): boolean;
	/** Counts one use for `key`. */
	hit(key: string): void;
	/** How long until `key` is allowed again, in whole seconds (at least 1), or 0 if allowed now. */
	retryAfterSeconds(key: string): number;
}

export function createRateLimiter(opts: {
	limit: number;
	windowMs: number;
	now?: () => number;
}): RateLimiter {
	const now = opts.now ?? Date.now;
	const hits = new Map<string, number[]>();

	/** The timestamps for `key` that are still inside the window. */
	function recent(key: string): number[] {
		const cutoff = now() - opts.windowMs;
		const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
		if (kept.length > 0) hits.set(key, kept);
		else hits.delete(key);
		return kept;
	}

	return {
		isLimited: (key) => recent(key).length >= opts.limit,
		hit(key) {
			const list = recent(key);
			list.push(now());
			hits.set(key, list);
			// Keep memory bounded if there are very many different keys.
			if (hits.size > 10_000) for (const k of [...hits.keys()]) recent(k);
		},
		retryAfterSeconds(key) {
			const list = recent(key);
			if (list.length < opts.limit) return 0;
			const frees = list[list.length - opts.limit] + opts.windowMs;
			return Math.max(1, Math.ceil((frees - now()) / 1000));
		}
	};
}
