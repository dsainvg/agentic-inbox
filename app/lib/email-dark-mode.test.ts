// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert";
import { describe, it } from "node:test";
import {
	adaptBackgroundColor,
	adaptBorderColor,
	adaptStyleString,
	adaptTextColor,
	getLightness,
	parseColor,
	processEmailDarkMode,
} from "./email-dark-mode.js";

describe("Email Dark Mode Engine", () => {
	describe("parseColor", () => {
		it("parses hex colors correctly", () => {
			assert.deepStrictEqual(parseColor("#ffffff"), { r: 255, g: 255, b: 255, a: 1 });
			assert.deepStrictEqual(parseColor("#000"), { r: 0, g: 0, b: 0, a: 1 });
			assert.deepStrictEqual(parseColor("#12345680"), {
				r: 0x12,
				g: 0x34,
				b: 0x56,
				a: 0x80 / 255,
			});
		});

		it("parses rgb/rgba colors correctly", () => {
			assert.deepStrictEqual(parseColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255, a: 1 });
			assert.deepStrictEqual(parseColor("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
		});

		it("parses named HTML colors", () => {
			assert.deepStrictEqual(parseColor("white"), { r: 255, g: 255, b: 255, a: 1 });
			assert.deepStrictEqual(parseColor("black"), { r: 0, g: 0, b: 0, a: 1 });
		});

		it("returns null for invalid or special colors", () => {
			assert.strictEqual(parseColor("transparent"), null);
			assert.strictEqual(parseColor("inherit"), null);
			assert.strictEqual(parseColor("invalidcolorname"), null);
		});
	});

	describe("getLightness", () => {
		it("calculates correct lightness values", () => {
			assert.strictEqual(getLightness({ r: 255, g: 255, b: 255, a: 1 }), 1);
			assert.strictEqual(getLightness({ r: 0, g: 0, b: 0, a: 1 }), 0);
		});
	});

	describe("adaptBackgroundColor", () => {
		it("transforms light backgrounds to dark equivalents", () => {
			const adaptedWhite = adaptBackgroundColor("#ffffff");
			const parsed = parseColor(adaptedWhite);
			assert.ok(parsed !== null);
			assert.ok(getLightness(parsed) < 0.25, "White background should become dark");
		});

		it("preserves already dark backgrounds", () => {
			const darkBg = "#1e1e1e";
			assert.strictEqual(adaptBackgroundColor(darkBg), darkBg);
		});
	});

	describe("adaptTextColor", () => {
		it("transforms dark text to light equivalents", () => {
			const adaptedBlack = adaptTextColor("#000000");
			const parsed = parseColor(adaptedBlack);
			assert.ok(parsed !== null);
			assert.ok(getLightness(parsed) > 0.7, "Black text should become light");
		});

		it("preserves already light text", () => {
			const lightText = "#ffffff";
			assert.strictEqual(adaptTextColor(lightText), lightText);
		});
	});

	describe("adaptStyleString", () => {
		it("transforms background and color declarations inside style string", () => {
			const inputStyle = "background-color: #ffffff; color: #000000; font-size: 14px";
			const outputStyle = adaptStyleString(inputStyle);

			assert.ok(!outputStyle.includes("color: #000000"));
			assert.ok(!outputStyle.includes("background-color: #ffffff"));
			assert.ok(outputStyle.includes("font-size: 14px"));
		});
	});

	describe("processEmailDarkMode", () => {
		it("transforms HTML bgcolor and color attributes", () => {
			const htmlInput = '<td bgcolor="#ffffff"><font color="#000000">Hello World</font></td>';
			const processed = processEmailDarkMode(htmlInput);

			assert.ok(!processed.includes('bgcolor="#ffffff"'));
			assert.ok(!processed.includes('color="#000000"'));
		});

		it("transforms style attributes in HTML tags", () => {
			const htmlInput = '<div style="background-color: #ffffff; color: #111111;">Content</div>';
			const processed = processEmailDarkMode(htmlInput);

			assert.ok(!processed.includes("background-color: #ffffff"));
			assert.ok(!processed.includes("color: #111111"));
		});

		it("transforms <style> block CSS rules", () => {
			const htmlInput = `
				<style>
					body { background-color: #ffffff; color: #222222; }
					.card { background: #f9f9f9; }
				</style>
				<div>Email body</div>
			`;
			const processed = processEmailDarkMode(htmlInput);

			assert.ok(!processed.includes("background-color: #ffffff"));
			assert.ok(!processed.includes("color: #222222"));
			assert.ok(!processed.includes("background: #f9f9f9"));
		});
	});
});
