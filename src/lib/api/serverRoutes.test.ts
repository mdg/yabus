import { describe, expect, test } from 'bun:test';
import { newRoute } from '#lib/geo/factory.ts';
import { fetchServerRoutes, fetchServerRouteNumbers } from './serverRoutes.ts';

const reply = (body: unknown, ok = true) =>
	(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('fetchServerRouteNumbers', () => {
	test('returns the route numbers from the list endpoint', async () => {
		const numbers = await fetchServerRouteNumbers(
			'demo',
			reply([{ number: '1', name: 'A' }, { number: '42X' }])
		);
		expect(numbers).toEqual(['1', '42X']);
	});

	test('asks for the right URL', async () => {
		let url = '';
		await fetchServerRouteNumbers('a b', (async (u: string) => {
			url = u;
			return { ok: true, json: async () => [] };
		}) as unknown as typeof fetch);
		expect(url).toBe('/api/users/a%20b/routes');
	});

	test('is empty when the server errors, is unreachable, or sends junk', async () => {
		expect(await fetchServerRouteNumbers('demo', reply([], false))).toEqual([]);
		expect(await fetchServerRouteNumbers('demo', reply({ not: 'a list' }))).toEqual([]);
		expect(await fetchServerRouteNumbers('demo', reply([null, 3, { number: 5 }]))).toEqual([]);
		const down = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await fetchServerRouteNumbers('demo', down)).toEqual([]);
	});
});

describe('fetchServerRoutes', () => {
	const list = [{ number: '1' }, { number: '2' }, { number: '3' }];
	const fake = (routes: Record<string, unknown>) =>
		(async (url: string) => {
			if (url.endsWith('/routes')) return { ok: true, json: async () => list };
			const number = decodeURIComponent(url.split('/').pop()!);
			if (!(number in routes)) return { ok: false, json: async () => null };
			return { ok: true, json: async () => routes[number] };
		}) as unknown as typeof fetch;

	test('fetches the list and then every route', async () => {
		const routes = await fetchServerRoutes('demo', fake({ '1': newRoute('1'), '2': newRoute('2'), '3': newRoute('3') }));
		expect(routes.map((r) => r.features[0].properties.number)).toEqual(['1', '2', '3']);
	});

	test('skips routes that are missing or do not validate', async () => {
		const routes = await fetchServerRoutes('demo', fake({ '1': newRoute('1'), '2': { junk: true } }));
		expect(routes.map((r) => r.features[0].properties.number)).toEqual(['1']);
	});

	test('a route whose number differs from the requested one is not trusted', async () => {
		const routes = await fetchServerRoutes('demo', fake({ '1': newRoute('9') }));
		expect(routes).toEqual([]);
	});

	test('an unreachable server gives an empty list', async () => {
		const down = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await fetchServerRoutes('demo', down)).toEqual([]);
	});
});
