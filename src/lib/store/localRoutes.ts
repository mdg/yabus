import { parseRoute, ROUTE_NUMBER_RE } from '#lib/geo/route.ts';
import type { RouteCollection } from '#lib/geo/types.ts';
import { username as hardcodedUsername } from '#lib/identity.ts';

const KEY_PREFIX = 'yabus:route:v1:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * The browser's working copy of the current user's own routes: one `localStorage` entry per
 * route, keyed `yabus:route:v1:{username}:{routeNumber}`. Routes that exist only on the
 * server are never copied in here.
 *
 * Storage can be unavailable or full (private windows, blocked site data, quota), so every
 * access is wrapped and failures surface as thrown Errors from `save` and empty results from
 * the readers.
 */
export function createLocalRoutes(
	username: string,
	storage: StorageLike = globalThis.localStorage
) {
	const prefix = `${KEY_PREFIX}${username}:`;
	const key = (routeNumber: string) => `${prefix}${routeNumber}`;

	return {
		/** Route numbers, in natural order (2 before 10). */
		list(): string[] {
			const numbers: string[] = [];
			try {
				for (let i = 0; i < storage.length; i++) {
					const k = storage.key(i);
					if (k?.startsWith(prefix)) {
						const n = k.slice(prefix.length);
						if (ROUTE_NUMBER_RE.test(n)) numbers.push(n);
					}
				}
			} catch {
				return [];
			}
			return numbers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		},

		/** Null when missing or unreadable. */
		get(routeNumber: string): RouteCollection | null {
			try {
				const raw = storage.getItem(key(routeNumber));
				if (raw === null) return null;
				const parsed = parseRoute(JSON.parse(raw), routeNumber);
				return parsed.ok ? parsed.route : null;
			} catch {
				return null;
			}
		},

		/** Every readable route, in natural number order. */
		all(): RouteCollection[] {
			return this.list().flatMap((n) => {
				const route = this.get(n);
				return route ? [route] : [];
			});
		},

		has(routeNumber: string): boolean {
			return this.get(routeNumber) !== null;
		},

		/** Validates and stores a route under its own number. Throws if invalid or not storable. */
		save(route: RouteCollection): void {
			const parsed = parseRoute(route);
			if (!parsed.ok) throw new Error(`invalid route: ${parsed.errors.join('; ')}`);
			const number = parsed.route.features[0].properties.number;
			try {
				storage.setItem(key(number), JSON.stringify(parsed.route));
			} catch (e) {
				throw new Error(`could not save route ${number} to localStorage`, { cause: e });
			}
		},

		remove(routeNumber: string): void {
			try {
				storage.removeItem(key(routeNumber));
			} catch {
				// nothing to do
			}
		}
	};
}

/** The store for the current (hardcoded) user, backed by the browser's `localStorage`. */
export function getLocalRoutes() {
	return createLocalRoutes(hardcodedUsername);
}
