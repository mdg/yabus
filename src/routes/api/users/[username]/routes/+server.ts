import { json } from '@sveltejs/kit';
import { routeSummary } from '#lib/geo/route.ts';
import { toHttpError } from '#lib/server/api.ts';
import { findReadDir, listRouteNumbers, readRoute } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

/** Lists a user's routes (public). Reads the first matching session directory. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const dir = await findReadDir(params.username);
		if (!dir) return json([]);
		const summaries = [];
		for (const number of await listRouteNumbers(dir)) {
			const route = await readRoute(dir, number);
			if (route) summaries.push(routeSummary(route));
		}
		return json(summaries);
	} catch (e) {
		toHttpError(e);
	}
};
