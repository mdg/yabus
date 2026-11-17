import { describe, expect, test } from 'bun:test';
import { RESERVED_USERNAMES, USERNAME_RE, validateUsername } from './username.ts';

describe('validateUsername', () => {
	test('accepts ordinary names', () => {
		for (const ok of ['demo', 'hudson-fan', 'bus_42', 'abc', '0day', 'a'.repeat(32)]) {
			expect(validateUsername(ok)).toBeNull();
		}
	});

	test('rejects names that are too short, too long or use other characters', () => {
		for (const bad of ['', 'a', 'ab', 'a'.repeat(33), 'Demo', 'DEMO', '-abc', '_abc', 'a b', 'a.b', 'a/b', '../x', 'é-name', 'a@b']) {
			expect(validateUsername(bad)).not.toBeNull();
		}
	});

	test('rejects reserved names', () => {
		for (const name of RESERVED_USERNAMES) expect(validateUsername(name)).toBe('That name is reserved.');
	});

	test('every reserved name would otherwise be a valid name', () => {
		// otherwise the reserved list is doing nothing for it
		for (const name of RESERVED_USERNAMES) expect(USERNAME_RE.test(name)).toBe(true);
	});
});
