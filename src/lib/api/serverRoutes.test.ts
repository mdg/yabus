import { describe, expect, test } from 'bun:test';
import { fetchServerRouteNumbers } from './serverRoutes.ts';

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
