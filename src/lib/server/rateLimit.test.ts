import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rateLimit.ts';

describe('createRateLimiter', () => {
	test('allows up to the limit, then blocks', () => {
		let t = 0;
		const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
		for (let i = 0; i < 3; i++) {
			expect(rl.isLimited('a')).toBe(false);
			rl.hit('a');
		}
		expect(rl.isLimited('a')).toBe(true);
	});

	test('keys are independent', () => {
		const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
		rl.hit('a');
		expect(rl.isLimited('a')).toBe(true);
		expect(rl.isLimited('b')).toBe(false);
	});

	test('the window slides: old hits stop counting', () => {
		let t = 0;
		const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
		rl.hit('a'); // t=0
		t = 600;
		rl.hit('a'); // t=600
		expect(rl.isLimited('a')).toBe(true);
		t = 1001; // the first hit is out of the window, the second is not
		expect(rl.isLimited('a')).toBe(false);
		rl.hit('a');
		expect(rl.isLimited('a')).toBe(true);
		t = 1700; // both earlier hits are gone
		expect(rl.isLimited('a')).toBe(false);
	});

	test('retryAfterSeconds says when the oldest relevant hit expires', () => {
		let t = 0;
		const rl = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => t });
		expect(rl.retryAfterSeconds('a')).toBe(0);
		rl.hit('a'); // t=0
		t = 4000;
		rl.hit('a'); // t=4000
		expect(rl.retryAfterSeconds('a')).toBe(6); // the t=0 hit frees up at 10000
		t = 9500;
		expect(rl.retryAfterSeconds('a')).toBe(1); // never below 1 while limited
		t = 10_001;
		expect(rl.retryAfterSeconds('a')).toBe(0);
	});
});
