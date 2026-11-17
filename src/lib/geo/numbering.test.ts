import { describe, expect, test } from 'bun:test';
import { nextRouteNumber, validateRouteNumber } from './numbering.ts';

describe('nextRouteNumber', () => {
	test('starts at 1', () => {
		expect(nextRouteNumber([])).toBe('1');
	});

	test('is the highest integer plus 1, not the first gap', () => {
		expect(nextRouteNumber(['1', '2', '5'])).toBe('6');
		expect(nextRouteNumber(['3'])).toBe('4');
	});

	test('ignores numbers that are not plain integers', () => {
		expect(nextRouteNumber(['42X', 'N3', '2'])).toBe('3');
		expect(nextRouteNumber(['42X', 'N3'])).toBe('1');
	});

	test('skips forward when the candidate is somehow taken', () => {
		// A 10-digit number is ignored when finding the "highest", so the first candidate,
		// 1000000000, is already taken and the next unused integer is used instead.
		expect(nextRouteNumber(['999999999', '1000000000'])).toBe('1000000001');
		expect(nextRouteNumber(['999999999', '1000000000', '1000000001'])).toBe('1000000002');
	});

	test('handles very long digit strings without breaking', () => {
		expect(nextRouteNumber(['9'.repeat(30)])).toBe('1');
		expect(nextRouteNumber(['999999999'])).toBe('1000000000');
	});

	test('accepts any iterable', () => {
		expect(nextRouteNumber(new Set(['4', '9']))).toBe('10');
	});
});

describe('validateRouteNumber', () => {
	test('accepts a free, well-formed number', () => {
		expect(validateRouteNumber('42X', '1', ['1', '2'])).toBeNull();
	});

	test('rejects malformed numbers', () => {
		for (const bad of ['', ' ', '../x', 'a b', '-1', 'x'.repeat(33)]) {
			expect(validateRouteNumber(bad, '1', [])).not.toBeNull();
		}
	});

	test('rejects a number another route has, ignoring case', () => {
		expect(validateRouteNumber('2', '1', ['1', '2'])).toContain('already exists');
		expect(validateRouteNumber('n3', '1', ['1', 'N3'])).toContain('already exists');
	});

	test('the route’s own number is not a conflict', () => {
		expect(validateRouteNumber('1', '1', ['1', '2'])).toBeNull();
		expect(validateRouteNumber('42x', '42X', ['42X'])).toBeNull();
	});
});
