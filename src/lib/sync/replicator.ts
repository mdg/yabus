import type { RouteCollection } from '#lib/geo/types.ts';

export type SyncStatus = 'idle' | 'saving' | 'error';

export interface ReplicatorOptions {
	username: string;
	fetchFn?: typeof fetch;
	/** How long to wait after the last change to a route before sending it. */
	delayMs?: number;
}

/** `keepalive` requests are capped at 64 KB by browsers, so larger bodies are sent normally. */
const KEEPALIVE_LIMIT = 60_000;

/**
 * Copies routes from `localStorage` to the server: debounced `PUT`s for edits, `DELETE`s for
 * deletes, and a PUT-then-DELETE for renames.
 *
 * `localStorage` is always the source of truth. This only ever sends local state to the server;
 * it never brings anything back. Failures are not retried (the next change to the route, or the
 * next page load, sends the then-current copy), and a failed `DELETE` is simply accepted.
 *
 * Requests for one route are sent strictly one after another, so a `DELETE` can never overtake
 * the `PUT` before it. Mutating requests carry `content-type: application/json`, which
 * SvelteKit's CSRF guard requires. The session cookie goes along automatically (same origin).
 */
export function createReplicator(options: ReplicatorOptions) {
	const { username } = options;
	const delayMs = options.delayMs ?? 800;
	const fetchFn: typeof fetch = options.fetchFn ?? globalThis.fetch;

	const pending = new Map<string, { route: RouteCollection; timer: ReturnType<typeof setTimeout> }>();
	const chains = new Map<string, Promise<boolean>>();
	const listeners = new Set<(status: SyncStatus) => void>();
	let active = 0; // requests queued or in flight
	let failing = false; // the most recent request failed
	let status: SyncStatus = 'idle';

	function refresh() {
		const next: SyncStatus = failing ? 'error' : pending.size > 0 || active > 0 ? 'saving' : 'idle';
		if (next === status) return;
		status = next;
		listeners.forEach((l) => l(next));
	}

	const url = (number: string) =>
		`/api/users/${encodeURIComponent(username)}/routes/${encodeURIComponent(number)}`;

	/** Sends a request; never throws. True when the server accepted it. */
	async function send(number: string, init: RequestInit): Promise<boolean> {
		try {
			return (await fetchFn(url(number), init)).ok;
		} catch {
			return false;
		}
	}

	/** Runs requests for one route number one after another. */
	function enqueue(number: string, task: () => Promise<boolean>): Promise<boolean> {
		active++;
		refresh();
		const run = (chains.get(number) ?? Promise.resolve(true)).then(task).then((ok) => {
			active--;
			failing = !ok;
			refresh();
			return ok;
		});
		chains.set(number, run);
		return run;
	}

	function cancelPending(number: string) {
		const entry = pending.get(number);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(number);
	}

	const numberOf = (route: RouteCollection) => route.features[0].properties.number;

	/** Sends the route now. */
	function push(route: RouteCollection, opts: { keepalive?: boolean } = {}): Promise<boolean> {
		const number = numberOf(route);
		cancelPending(number);
		const body = JSON.stringify(route);
		const init: RequestInit = {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body
		};
		if (opts.keepalive && body.length < KEEPALIVE_LIMIT) init.keepalive = true;
		return enqueue(number, () => send(number, init));
	}

	/** Sends the route after a short quiet period. A newer change to the same route replaces it. */
	function schedule(route: RouteCollection): void {
		const number = numberOf(route);
		cancelPending(number);
		const timer = setTimeout(() => {
			pending.delete(number);
			void push(route);
		}, delayMs);
		pending.set(number, { route, timer });
		refresh();
	}

	/** Deletes the route on the server. A change still waiting to be sent is dropped. */
	function remove(number: string): Promise<boolean> {
		cancelPending(number);
		return enqueue(number, () =>
			send(number, { method: 'DELETE', headers: { 'content-type': 'application/json' } })
		);
	}

	/** Saves the route under its new number, then removes the old one. If the save fails, the old copy stays. */
	async function rename(oldNumber: string, route: RouteCollection): Promise<boolean> {
		if (!(await push(route))) return false;
		return remove(oldNumber);
	}

	/** Sends everything that is waiting right away (for when the page is being left). */
	function flush(opts: { keepalive?: boolean } = {}): Promise<boolean[]> {
		const waiting = [...pending.values()].map((e) => e.route);
		return Promise.all(waiting.map((route) => push(route, opts)));
	}

	/** Resolves once nothing is waiting or in flight. */
	async function settled(): Promise<void> {
		await flush();
		await Promise.all([...chains.values()]);
	}

	function subscribe(listener: (status: SyncStatus) => void): () => void {
		listeners.add(listener);
		listener(status);
		return () => void listeners.delete(listener);
	}

	return { push, schedule, remove, rename, flush, settled, subscribe };
}

export type Replicator = ReturnType<typeof createReplicator>;
