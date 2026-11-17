const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of a `#rrggbb` color (0 = black, 1 = white). */
function luminance(hex: string): number {
	return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

/**
 * White or black, whichever reads better on top of the given `#rrggbb` background.
 * White is preferred whenever its contrast is at least 3:1 (the usual minimum for UI
 * elements), because white on red, blue, teal and the like is what people expect to see.
 */
export function contrastColor(background: string): '#ffffff' | '#000000' {
	const againstWhite = 1.05 / (luminance(background) + 0.05);
	return againstWhite >= 3 ? '#ffffff' : '#000000';
}
