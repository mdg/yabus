import { describe, expect, test } from 'bun:test';
import { appendWaypoint } from '#lib/geo/edit.ts';
import { newRoute } from '#lib/geo/factory.ts';
import type { RouteCollection } from '#lib/geo/types.ts';
import { reconcile } from './reconcile.ts';

const withName = (r: RouteCollection, name: string): RouteCollection => ({
	...r,
	features: [{ ...r.features[0], properties: { ...r.features[0].properties, name } }]
});

/** A fake server holding these routes. */
function serverWith(routes: RouteCollection[]) {
	const byNumber = new Map(routes.map((r) => [r.features[0].properties.number, r]));
	return (async (url: string) => {
		if (url.endsWith('/routes')) {
			return { ok: true, json: async () => [...byNumber.keys()].map((number) => ({ number })) };
		}
		const route = byNumber.get(decodeURIComponent(url.split('/').pop()!));
		return route ? { ok: true, json: async () => route } : { ok: false, json: async () => null };
	}) as unknown as typeof fetch;
}

function recorder() {
	const pushed: string[] = [];
	return { pushed, replicator: { push: async (r: RouteCollection) => (pushed.push(r.features[0].properties.number), true) } };
}

describe('reconcile', () => {
	test('sends local routes the server does not have', async () => {
		const { pushed, replicator } = recorder();
		const sent = await reconcile({ username: 'demo', local: [newRoute('1'), newRoute('2')], replicator, fetchFn: serverWith([]) });
		expect(sent).toEqual(['1', '2']);
		expect(pushed).toEqual(['1', '2']);
	});

	test('local wins: a different server copy is overwritten', async () => {
		const { pushed, replicator } = recorder();
		const local = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		const sent = await reconcile({ username: 'demo', local: [local], replicator, fetchFn: serverWith([withName(newRoute('1'), 'stale')]) });
		expect(sent).toEqual(['1']);
		expect(pushed).toEqual(['1']);
	});

	test('identical copies are not sent again', async () => {
		const { pushed, replicator } = recorder();
		const same = appendWaypoint(newRoute('1'), [-74.1, 40.7]);
		const sent = await reconcile({ username: 'demo', local: [same], replicator, fetchFn: serverWith([same]) });
		expect(sent).toEqual([]);
		expect(pushed).toEqual([]);
	});

	test('server-only routes are left alone', async () => {
		const { pushed, replicator } = recorder();
		const shared = newRoute('1'); // the same route on both sides
		const sent = await reconcile({ username: 'demo', local: [shared], replicator, fetchFn: serverWith([shared, newRoute('9')]) });
		expect(sent).toEqual([]);
		expect(pushed).not.toContain('9');
	});

	test('with nothing local there is nothing to send', async () => {
		const { replicator } = recorder();
		expect(await reconcile({ username: 'demo', local: [], replicator, fetchFn: serverWith([newRoute('4')]) })).toEqual([]);
	});
});
