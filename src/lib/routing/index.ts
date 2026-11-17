import { StraightLineRouter, type Router } from './router.ts';

export type { Router } from './router.ts';

/** The router the app uses. Straight lines for now; Valhalla replaces this in its milestone. */
export function getRouter(): Router {
	return new StraightLineRouter();
}
