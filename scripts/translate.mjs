#!/usr/bin/env node
/**
 * Auto-translate Simplified Chinese posts into Japanese & English using an
 * OpenAI-compatible chat API (configured in .env).
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/translate.mjs [--force] [--dry] [--langs a,b]
 *
 * Env vars (.env):
 *   AI_API_BASE     e.g. https://api.deepseek.com/v1   (OpenAI-compatible endpoint)
 *   AI_API_KEY      your API key
 *   AI_MODEL        e.g. deepseek-chat
 *   AI_TARGET_LANGS comma-separated target languages (optional)
 *
 * Target languages resolve in this order:
 *   --langs CLI flag  >  AI_TARGET_LANGS (.env)  >  i18nConfig.translateTo
 *   (src/site.config.ts)  >  built-in default ["ja", "en"]
 *
 * Behaviour:
 *   - Scans content/posts/** for posts whose `lang` is zh-CN/zh (or unset).
 *   - Writes translations to content/translations/<lang>/<slug>.md, committed to git.
 *   - Incremental: skips posts whose translation sourceHash already matches,
 *     pass --force to re-translate everything.
 *   - --dry prints what would be done without calling the API.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const POSTS_DIR = join(ROOT, "content", "posts");
const TRANS_DIR = join(ROOT, "content", "translations");

/* ---------------- .env fallback (so `node scripts/translate.mjs` also works) ---------------- */
if (existsSync(join(ROOT, ".env"))) {
	for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (m && !(m[1] in process.env)) {
			let v = m[2];
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			process.env[m[1]] = v;
		}
	}
}

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");
const AI_BASE = process.env.AI_API_BASE?.replace(/\/+$/, "");
const AI_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL;

/* ---------------- single source of truth: src/site.config.ts ---------------- */
// site.config.ts is TypeScript, so a plain Node script can't import it — we
// read the `i18nConfig` block with a regex instead (the format is part of this
// template's contract). CLI/env still win over the config.
function readI18nConfigFromSite() {
	const p = join(ROOT, "src", "site.config.ts");
	if (!existsSync(p)) return null;
	const src = readFileSync(p, "utf8");
	const block = src.match(/export const i18nConfig\s*=\s*\{([\s\S]*?)\n\};/);
	if (!block) return null;
	const body = block[1];
	const locales = [];
	const labels = {};
	for (const m of body.matchAll(/code:\s*["']([^"']+)["']/g)) {
		const code = m[1];
		locales.push(code);
		const lm = body.match(
			new RegExp(`code:\\s*["']${code}["'][\\s\\S]{0,80}?label:\\s*["']([^"']+)["']`),
		);
		labels[code] = lm?.[1] ?? code;
	}
	const ttM = body.match(/translateTo:\s*\[([^\]]*)\]/);
	const translateTo = ttM
		? [...ttM[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1])
		: null;
	return { translateTo, locales, labels };
}

const siteI18n = readI18nConfigFromSite();

// Names used in the translation prompts. Config labels are preferred; the
// fallback map keeps prompts readable for short UI labels (e.g. "中文").
const FALLBACK_NAMES = { en: "English", ja: "Japanese (日本語)", zh: "简体中文" };
const LANG_NAMES = { ...(siteI18n?.labels ?? {}), ...FALLBACK_NAMES };

// Target languages, in precedence order:
//   --langs <a,b> CLI  >  AI_TARGET_LANGS (.env)  >  i18nConfig.translateTo  >  default ["ja","en"]
const langsFlagIndex = process.argv.indexOf("--langs");
const langsFlag = langsFlagIndex >= 0 ? process.argv[langsFlagIndex + 1] : null;
const TARGETS = (langsFlag ?? process.env.AI_TARGET_LANGS ?? siteI18n?.translateTo?.join(",") ?? "ja,en")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

if (!DRY && (!AI_BASE || !AI_KEY || !AI_MODEL)) {
	console.error(
		"Missing AI config. Set AI_API_BASE, AI_API_KEY and AI_MODEL in .env (see .example.env).",
	);
	process.exit(1);
}

/* ---------------- helpers ---------------- */
function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) out.push(...walk(p));
		else if (/\.(md|mdx)$/.test(name)) out.push(p);
	}
	return out;
}

function splitFrontmatter(raw) {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { data: {}, body: raw };
	let data;
	try {
		data = yaml.load(m[1]) ?? {};
	} catch {
		data = {};
	}
	return { data, body: m[2].trimStart() };
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function chat(messages) {
	const res = await fetch(`${AI_BASE}/chat/completions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: AI_MODEL, temperature: 0.2, messages }),
	});
	if (!res.ok) throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const data = await res.json();
	const content = data.choices?.[0]?.message?.content ?? "";
	return content.trim();
}

function parseJsonResponse(text) {
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim();
	return JSON.parse(cleaned);
}

async function translateMeta(title, description, lang) {
	const system = `You are a professional translator. Translate the title and description of a blog post from Simplified Chinese into ${LANG_NAMES[lang]}. Return ONLY a JSON object with the shape {"title":"...","description":"..."}. Preserve proper nouns; do not translate names/brands.`;
	const user = `Title: ${title}\n\nDescription: ${description}`;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return parseJsonResponse(
				await chat([
					{ role: "system", content: system },
					{ role: "user", content: user },
				]),
			);
		} catch (err) {
			if (attempt === 0) console.warn(`    meta JSON parse failed, retrying… (${err.message})`);
			else throw new Error(`could not parse meta JSON: ${err.message}`);
		}
	}
}

async function translateBody(body, lang) {
	const system = `You are a professional translator. Translate the following Markdown blog post from Simplified Chinese into ${LANG_NAMES[lang]}. Preserve ALL Markdown syntax, headings, lists, links, images, inline code and code blocks exactly. Do NOT translate code, URLs, or filenames. Keep the frontmatter out — translate only the body. Output ONLY the translated Markdown with no preamble or code fences.`;
	const user = body;
	return chat([
		{ role: "system", content: system },
		{ role: "user", content: user },
	]);
}

/* ---------------- main ---------------- */
const sources = walk(POSTS_DIR);
if (!sources.length) {
	console.log("No posts found in content/posts/ — nothing to translate.");
	process.exit(0);
}

let done = 0;
let skipped = 0;
let failed = 0;

for (const srcPath of sources) {
	const srcRaw = readFileSync(srcPath, "utf8");
	const { data, body } = splitFrontmatter(srcRaw);
	const lang = data.lang ?? "zh-CN";
	if (!["zh-CN", "zh"].includes(lang)) {
		console.log(`skip   ${srcPath} (lang=${lang}, not Simplified Chinese)`);
		continue;
	}

	const rel = srcPath.slice(POSTS_DIR.length + 1);
	const ext = extname(rel);
	const slug = rel.slice(0, -ext.length);
	const hash = sha256(srcRaw);

	for (const target of TARGETS) {
		if (!LANG_NAMES[target]) {
			console.warn(
				`unknown target language "${target}" — add it to i18nConfig.locales in src/site.config.ts (skipped)`,
			);
			continue;
		}
		const outPath = join(TRANS_DIR, target, `${slug}${ext}`);
		const existingRaw = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
		const existingHash = existingRaw ? splitFrontmatter(existingRaw).data.sourceHash : null;

		if (!FORCE && existingHash === hash) {
			console.log(`ok     [${target}] ${rel} (up to date)`);
			skipped++;
			continue;
		}

		if (DRY) {
			console.log(`would  [${target}] ${rel}`);
			continue;
		}

		try {
			const meta = await translateMeta(data.title, data.description ?? "", target);
			const newBody = await translateBody(body, target);

			const outMeta = {
				title: meta.title,
				description: meta.description,
				publishDate: data.publishDate,
			};
			if (data.updatedDate) outMeta.updatedDate = data.updatedDate;
			outMeta.tags = Array.isArray(data.tags) ? data.tags : [];
			if (typeof data.draft === "boolean") outMeta.draft = data.draft;
			if (typeof data.pinned === "boolean") outMeta.pinned = data.pinned;
			outMeta.lang = target;
			outMeta.source = `posts/${slug}`;
			outMeta.sourceHash = hash;

			const fm = yaml.dump(outMeta).trimEnd();
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, `---\n${fm}\n---\n\n${newBody.trim()}\n`);
			console.log(`wrote  [${target}] ${rel}`);
			done++;
		} catch (err) {
			console.error(`error  [${target}] ${rel}: ${err.message}`);
			failed++;
		}
	}
}

console.log(`\nTranslated ${done}, up-to-date ${skipped}, failed ${failed}.`);
if (failed) process.exitCode = 1;
