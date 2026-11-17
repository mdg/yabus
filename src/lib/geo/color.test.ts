import { describe, expect, test } from 'bun:test';
import { contrastColor } from './color.ts';
import { ROUTE_COLORS } from './factory.ts';

describe('contrastColor', () => {
	test('white on dark colors, black on light ones', () => {
		expect(contrastColor('#000000')).toBe('#ffffff');
		expect(contrastColor('#1d70b8')).toBe('#ffffff');
		expect(contrastColor('#e63946')).toBe('#ffffff'); // the default red
		expect(contrastColor('#ffffff')).toBe('#000000');
		expect(contrastColor('#ffd60a')).toBe('#000000');
		expect(contrastColor('#f4a261')).toBe('#000000');
	});

	test('always returns black or white for the palette', () => {
		for (const c of ROUTE_COLORS) expect(['#ffffff', '#000000']).toContain(contrastColor(c));
	});
});
