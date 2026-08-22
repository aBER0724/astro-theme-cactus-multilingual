/**
 * Regenerate the site's default social card (public/social-card.png) with
 * personal branding, using the same satori + sharp stack as
 * src/pages/og-image/[...slug].png.ts.
 *
 * Usage (from repo root): node scripts/generate-social-card.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import satori from "satori";
import { html } from "satori-html";
import sharp from "sharp";

// Pull title/author straight from the config so the card never drifts.
const config = readFileSync(new URL("../src/site.config.ts", import.meta.url), "utf8");
const title = config.match(/title:\s*"([^"]+)"/)?.[1] ?? "Blog";
const author = config.match(/author:\s*"([^"]+)"/)?.[1] ?? "";

const regularFont = readFileSync(new URL("../src/assets/roboto-mono-regular.ttf", import.meta.url));
const boldFont = readFileSync(new URL("../src/assets/roboto-mono-700.ttf", import.meta.url));

const markup = html`<div tw="flex flex-col w-full h-full bg-[#1d1f21] text-[#c9cacc]">
	<div tw="flex flex-col flex-1 w-full p-10 justify-center">
		<h1 tw="text-7xl font-bold text-white">${title}</h1>
	</div>
	<div tw="flex items-center justify-between w-full p-10 border-t-2 border-[#2bbc89] text-white">
		<p tw="text-2xl ml-3 font-semibold">${title}</p>
		<p tw="text-2xl font-semibold">by ${author}</p>
	</div>
</div>`;

const svg = await satori(markup, {
	width: 1200,
	height: 630,
	fonts: [
		{ name: "Roboto Mono", data: regularFont, weight: 400, style: "normal" },
		{ name: "Roboto Mono", data: boldFont, weight: 700, style: "normal" },
	],
});

const png = await sharp(Buffer.from(svg)).png().toBuffer();
const out = new URL("../public/social-card.png", import.meta.url);
writeFileSync(out, png);
console.log(`Wrote ${out.pathname} (${png.length} bytes)`);
