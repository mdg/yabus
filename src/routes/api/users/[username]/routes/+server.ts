import { json } from '@sveltejs/kit';
import { routeSummary } from '#lib/geo/route.ts';
import { toResponse } from '#lib/server/api.ts';
import { listRouteNumbers, readRoute } from '#lib/server/storage.ts';
import { getUser, userDir } from '#lib/server/users.ts';
import type { RequestHandler } from './$types';

/** Lists a user's routes (public). An unknown user has no routes. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const user = await getUser(params.username);
		if (!user) return json([]);
		const dir = userDir(user.username);
		const summaries = [];
		for (const number of await listRouteNumbers(dir)) {
			const route = await readRoute(dir, number);
			if (route) summaries.push(routeSummary(route));
		}
		return json(summaries);
	} catch (e) {
		return toResponse(e);
	}
};
