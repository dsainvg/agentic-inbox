// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Utility module for parsing, analyzing, and adapting email HTML/CSS for dark mode.
 */

// Named HTML colors map to RGB values
const NAMED_COLORS: Record<string, [number, number, number]> = {
	white: [255, 255, 255],
	black: [0, 0, 0],
	red: [255, 0, 0],
	green: [0, 128, 0],
	blue: [0, 0, 255],
	yellow: [255, 255, 0],
	purple: [128, 0, 128],
	gray: [128, 128, 128],
	grey: [128, 128, 128],
	silver: [192, 192, 192],
	maroon: [128, 0, 0],
	navy: [0, 0, 128],
	olive: [128, 128, 0],
	teal: [0, 128, 128],
	aqua: [0, 255, 255],
	fuchsia: [255, 0, 255],
	lime: [0, 255, 0],
	orange: [255, 165, 0],
	snow: [255, 250, 250],
	ghostwhite: [248, 248, 255],
	whitesmoke: [245, 245, 245],
	gainsboro: [220, 220, 220],
	floralwhite: [255, 250, 240],
	oldlace: [253, 245, 230],
	linen: [250, 240, 230],
	antiquewhite: [250, 235, 215],
	papayawhip: [255, 239, 213],
	blanchedalmond: [255, 235, 205],
	bisque: [255, 228, 196],
	peachpuff: [255, 218, 185],
	navajowhite: [255, 222, 173],
	moccasin: [255, 228, 181],
	cornsilk: [255, 248, 220],
	ivory: [255, 255, 240],
	lemonchiffon: [255, 250, 205],
	seashell: [255, 245, 238],
	honeydew: [240, 255, 240],
	mintcream: [245, 255, 250],
	azure: [240, 255, 255],
	aliceblue: [240, 248, 255],
	lavender: [230, 230, 250],
	lavenderblush: [255, 240, 245],
	mistyrose: [255, 228, 225],
	darkslategray: [47, 79, 79],
	darkslategrey: [47, 79, 79],
	dimgray: [105, 105, 105],
	dimgrey: [105, 105, 105],
	lightgray: [211, 211, 211],
	lightgrey: [211, 211, 211],
	lightslategray: [119, 136, 153],
	lightslategrey: [119, 136, 153],
	darkgray: [169, 169, 169],
	darkgrey: [169, 169, 169],
};

export interface RGBA {
	r: number;
	g: number;
	b: number;
	a: number;
}

/**
 * Parse any CSS color string into RGBA.
 * Returns null if string is not a recognized color or special (e.g. transparent, inherit).
 */
export function parseColor(colorStr: string): RGBA | null {
	if (!colorStr) return null;
	const str = colorStr.trim().toLowerCase();

	if (str === "transparent" || str === "inherit" || str === "initial" || str === "unset" || str === "currentcolor") {
		return null;
	}

	// Hex format: #rgb, #rgba, #rrggbb, #rrggbbaa
	if (str.startsWith("#")) {
		const hex = str.slice(1);
		if (hex.length === 3 || hex.length === 4) {
			const r = parseInt(hex[0] + hex[0], 16);
			const g = parseInt(hex[1] + hex[1], 16);
			const b = parseInt(hex[2] + hex[2], 16);
			const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
			if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return { r, g, b, a };
		} else if (hex.length === 6 || hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
			if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return { r, g, b, a };
		}
		return null;
	}

	// rgb / rgba format
	const rgbMatch = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
	if (rgbMatch) {
		const r = parseInt(rgbMatch[1], 10);
		const g = parseInt(rgbMatch[2], 10);
		const b = parseInt(rgbMatch[3], 10);
		const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
		return { r, g, b, a };
	}

	// Named colors
	if (NAMED_COLORS[str]) {
		const [r, g, b] = NAMED_COLORS[str];
		return { r, g, b, a: 1 };
	}

	return null;
}

/**
 * Calculates relative lightness (0 to 1) of an RGBA color.
 */
export function getLightness(rgba: RGBA): number {
	const r = rgba.r / 255;
	const g = rgba.g / 255;
	const b = rgba.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return (max + min) / 2;
}

/**
 * Calculates relative luminance according to WCAG 2.x standard.
 */
export function getLuminance(rgba: RGBA): number {
	const normalize = (c: number) => {
		const val = c / 255;
		return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * normalize(rgba.r) + 0.7152 * normalize(rgba.g) + 0.0722 * normalize(rgba.b);
}

/**
 * Convert RGBA back to CSS hex or rgba string.
 */
export function formatColor(rgba: RGBA): string {
	if (rgba.a < 1) {
		return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${Number(rgba.a.toFixed(2))})`;
	}
	const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
	return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`;
}

/**
 * Invert / adapt background color for dark mode.
 * - Light backgrounds (> 0.45 lightness) are inverted to clean dark shades.
 * - Already dark backgrounds are kept dark.
 */
export function adaptBackgroundColor(colorStr: string): string {
	const parsed = parseColor(colorStr);
	if (!parsed) return colorStr;

	const lightness = getLightness(parsed);
	if (lightness <= 0.45) {
		// Already dark background, keep it
		return colorStr;
	}

	// Target dark lightness (0.08 ~ 0.20)
	const targetLightness = 0.08 + (1 - lightness) * 0.18;

	const isGrayscale = Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b) < 15;
	if (isGrayscale) {
		const val = Math.round(targetLightness * 255);
		return formatColor({ r: val, g: val, b: val, a: parsed.a });
	}

	// For colored light background, scale down to target lightness while keeping hue
	const currentMax = Math.max(parsed.r, parsed.g, parsed.b, 1);
	const scale = (targetLightness * 255) / currentMax;

	const newR = Math.min(255, Math.round(parsed.r * scale));
	const newG = Math.min(255, Math.round(parsed.g * scale));
	const newB = Math.min(255, Math.round(parsed.b * scale));

	return formatColor({ r: newR, g: newG, b: newB, a: parsed.a });
}

/**
 * Invert / adapt text foreground color for dark mode.
 * - Dark text (< 0.55 lightness) is converted to readable light colors.
 * - Already light text is preserved.
 */
export function adaptTextColor(colorStr: string): string {
	const parsed = parseColor(colorStr);
	if (!parsed) return colorStr;

	const lightness = getLightness(parsed);
	if (lightness >= 0.55) {
		// Already light text, keep it
		return colorStr;
	}

	// For dark text, calculate target lightness (~0.80 - 0.95)
	const targetLightness = 0.95 - lightness * 0.3;

	// If the original color is black or grayscale (low saturation / r,g,b close)
	const isGrayscale = Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b) < 15;
	if (isGrayscale) {
		const val = Math.round(targetLightness * 255);
		return formatColor({ r: val, g: val, b: val, a: parsed.a });
	}

	// For colored dark text (e.g., dark blue/red), boost brightness while retaining hue
	const currentMax = Math.max(parsed.r, parsed.g, parsed.b, 1);
	const scale = (targetLightness * 255) / currentMax;

	const newR = Math.min(255, Math.round(parsed.r * scale));
	const newG = Math.min(255, Math.round(parsed.g * scale));
	const newB = Math.min(255, Math.round(parsed.b * scale));

	return formatColor({ r: newR, g: newG, b: newB, a: parsed.a });
}

/**
 * Adapt border colors for dark mode.
 */
export function adaptBorderColor(colorStr: string): string {
	const parsed = parseColor(colorStr);
	if (!parsed) return colorStr;

	const lightness = getLightness(parsed);
	if (lightness > 0.7) {
		return "rgba(255, 255, 255, 0.12)";
	}
	if (lightness < 0.3) {
		return "rgba(255, 255, 255, 0.25)";
	}
	return colorStr;
}

/**
 * Parse and transform inline style attribute strings.
 */
export function adaptStyleString(styleStr: string): string {
	if (!styleStr) return styleStr;

	const declarations = styleStr.split(";");
	const updatedDecls = declarations.map((decl) => {
		const colonIdx = decl.indexOf(":");
		if (colonIdx === -1) return decl;

		const property = decl.slice(0, colonIdx).trim().toLowerCase();
		const value = decl.slice(colonIdx + 1).trim();

		if (!value) return decl;

		if (property === "background-color" || property === "background") {
			// Handle background values that might contain color + images/gradients
			const matchColor = value.match(/^(#[a-f0-9]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
			if (matchColor) {
				const color = matchColor[1];
				const adapted = adaptBackgroundColor(color);
				return `${property}: ${value.replace(color, adapted)}`;
			}
		} else if (property === "color") {
			const important = value.match(/\s*!important\s*$/i)?.[0] ?? "";
			const colorValue = important ? value.slice(0, value.length - important.length).trim() : value;
			const adapted = adaptTextColor(colorValue);
			return `${property}: ${adapted}${important}`;
		} else if (property.includes("border") && property.includes("color")) {
			const adapted = adaptBorderColor(value);
			return `${property}: ${adapted}`;
		}

		return decl;
	});

	return updatedDecls.join(";");
}

/**
 * Processes an HTML email string and applies dark mode transformations to inline styles,
 * HTML attributes (bgcolor, color), and embedded CSS <style> blocks.
 */
export function processEmailDarkMode(htmlStr: string): string {
	if (!htmlStr) return htmlStr;

	let processed = htmlStr;

	// 1. Transform bgcolor="..." attribute
	processed = processed.replace(/\b(bgcolor|color)=["']([^"']+)["']/gi, (match, attr, val) => {
		const attrLower = attr.toLowerCase();
		if (attrLower === "bgcolor") {
			const adapted = adaptBackgroundColor(val);
			return `${attr}="${adapted}"`;
		} else if (attrLower === "color") {
			const adapted = adaptTextColor(val);
			return `${attr}="${adapted}"`;
		}
		return match;
	});

	// 2. Transform style="..." attribute
	processed = processed.replace(/\bstyle=(["'])(.*?)\1/gi, (match, quote, styleContent) => {
		const adaptedStyle = adaptStyleString(styleContent);
		return `style=${quote}${adaptedStyle}${quote}`;
	});

	// 3. Transform CSS color rules inside <style> tags
	processed = processed.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, startTag, cssContent, endTag) => {
		let updatedCss = cssContent;

		// Adapt background / background-color in CSS
		updatedCss = updatedCss.replace(/(background(?:-color)?\s*:\s*)([^;!}]+)/gi, (m, prop, val) => {
			const valTrim = val.trim();
			const parsed = parseColor(valTrim);
			if (parsed) {
				return `${prop}${adaptBackgroundColor(valTrim)}`;
			}
			return m;
		});

		// Adapt text color in CSS
		updatedCss = updatedCss.replace(/(color\s*:\s*)([^;!}]+)/gi, (m, prop, val) => {
			const valTrim = val.trim();
			const parsed = parseColor(valTrim);
			if (parsed) {
				return `${prop}${adaptTextColor(valTrim)}`;
			}
			return m;
		});

		return `${startTag}${updatedCss}${endTag}`;
	});

	return processed;
}
