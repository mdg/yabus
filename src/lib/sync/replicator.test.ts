import { describe, expect, test } from 'bun:test';
import { newRoute } from '#lib/geo/factory.ts';
import { createReplicator } from './replicator.ts';

interface Call {
	method: string;
	url: string;
	body?: string;
	contentType?: string;
	keepalive?: boolean;
}

function fakeFetch(respond: (call: Call) => boolean | Promise<boolean> = () => true) {
	const calls: Call[] = [];
	const fetchFn = (async (url: string, init?: RequestInit) => {
		const call: Call = {
			method: init?.method ?? 'GET',
			url,
			body: init?.body as string | undefined,
			contentType: (init?.headers as Record<string, string> | undefined)?.['content-type'],
			keepalive: init?.keepalive
		};
		calls.push(call);
		return { ok: await respond(call) };
	}) as unknown as typeof fetch;
	return { fetchFn, calls };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const named = (number: string, name: string) => {
	const r = newRoute(number);
	return { ...r, features: [{ ...r.features[0], properties: { ...r.features[0].properties, name } }] };
};

describe('replicator', () => {
	test('PUTs to the right URL with a JSON content type', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 5 });
		await rep.push(named('7', 'Seven'));
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('PUT');
		expect(calls[0].url).toBe('/api/users/demo/routes/7');
		expect(calls[0].contentType).toBe('application/json');
		expect(JSON.parse(calls[0].body!).features[0].properties.name).toBe('Seven');
	});

	test('rapid changes to one route are sent once, with the latest copy', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 20 });
		rep.schedule(named('1', 'first'));
		rep.schedule(named('1', 'second'));
		rep.schedule(named('1', 'third'));
		expect(calls).toHaveLength(0); // still waiting
		await sleep(80);
		await rep.settled();
		expect(calls).toHaveLength(1);
		expect(JSON.parse(calls[0].body!).features[0].properties.name).toBe('third');
	});

	test('different routes are sent separately', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 5 });
		rep.schedule(named('1', 'a'));
		rep.schedule(named('2', 'b'));
		await sleep(40);
		await rep.settled();
		expect(calls.map((c) => c.url).sort()).toEqual(['/api/users/demo/routes/1', '/api/users/demo/routes/2']);
	});

	test('remove sends a DELETE and drops a change that was still waiting', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 30 });
		rep.schedule(named('3', 'never sent'));
		await rep.remove('3');
		await sleep(60);
		await rep.settled();
		expect(calls.map((c) => c.method)).toEqual(['DELETE']);
		expect(calls[0].url).toBe('/api/users/demo/routes/3');
		expect(calls[0].contentType).toBe('application/json');
	});

	test('rename saves the new number first, then deletes the old one', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn });
		expect(await rep.rename('1', named('N3', 'x'))).toBe(true);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'PUT /api/users/demo/routes/N3',
			'DELETE /api/users/demo/routes/1'
		]);
	});

	test('a failed save during a rename keeps the old copy', async () => {
		const { fetchFn, calls } = fakeFetch((c) => c.method !== 'PUT');
		const rep = createReplicator({ username: 'demo', fetchFn });
		expect(await rep.rename('1', named('N3', 'x'))).toBe(false);
		expect(calls.map((c) => c.method)).toEqual(['PUT']);
	});

	test('requests for one route never overtake each other', async () => {
		const order: string[] = [];
		const { fetchFn } = fakeFetch(async (c) => {
			if (c.method === 'PUT') await sleep(40); // a slow PUT
			order.push(c.method);
			return true;
		});
		const rep = createReplicator({ username: 'demo', fetchFn });
		void rep.push(named('1', 'x'));
		await rep.remove('1'); // issued while the PUT is still in flight
		expect(order).toEqual(['PUT', 'DELETE']);
	});

	test('status goes saving, idle, error, then idle again after a success', async () => {
		let ok = false;
		const { fetchFn } = fakeFetch(() => ok);
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 5 });
		const seen: string[] = [];
		const stop = rep.subscribe((s) => seen.push(s));
		await rep.push(named('1', 'x')); // fails
		ok = true;
		await rep.push(named('1', 'y')); // succeeds
		stop();
		expect(seen[0]).toBe('idle');
		expect(seen).toContain('saving');
		expect(seen).toContain('error');
		expect(seen[seen.length - 1]).toBe('idle');
	});

	test('network failures do not throw', async () => {
		const fetchFn = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const rep = createReplicator({ username: 'demo', fetchFn });
		expect(await rep.push(named('1', 'x'))).toBe(false);
		expect(await rep.remove('1')).toBe(false);
	});

	test('flush sends waiting changes immediately, with keepalive for small bodies', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn, delayMs: 10_000 });
		rep.schedule(named('1', 'a'));
		await rep.flush({ keepalive: true });
		expect(calls).toHaveLength(1);
		expect(calls[0].keepalive).toBe(true);
	});

	test('an oversized body is sent without keepalive', async () => {
		const { fetchFn, calls } = fakeFetch();
		const rep = createReplicator({ username: 'demo', fetchFn });
		await rep.push(named('1', 'x'.repeat(70_000)), { keepalive: true });
		expect(calls[0].keepalive).toBeUndefined();
	});
});
