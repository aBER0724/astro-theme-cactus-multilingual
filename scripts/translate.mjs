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
 *   - Scans content/posts/** for posts whose `lang` is zh-CN/zh (or unset),
 *     and content/projects/** for project descriptions.
 *   - Writes translations to content/translations/<lang>/<slug>.md (posts)
 *     and content/translations/<lang>/projects/<slug>.md (projects).
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
const PROJECTS_DIR = join(ROOT, "content", "projects");
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
	const translateTo = ttM ? [...ttM[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : null;
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
const TARGETS = (
	langsFlag ??
	process.env.AI_TARGET_LANGS ??
	siteI18n?.translateTo?.join(",") ??
	"ja,en"
)
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

/* Transient upstream failures (Cloudflare 524, 429 rate limit, 5xx) used to
 * bubble up and blow away a whole 10-minute translation attempt. Retry them
 * here with exponential backoff; 4xx like 401/400 are real errors. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 522, 523, 524, 529]);
async function chatOnce(messages) {
	const res = await fetch(`${AI_BASE}/chat/completions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
		// Streaming mode: gateways (Cloudflare etc.) kill long silent
		// non-streaming requests with 524 while the model is still thinking.
		// With stream:true chunks arrive every second or so and the
		// connection stays alive for arbitrarily long generations.
		body: JSON.stringify({ model: AI_MODEL, temperature: 0.2, messages, stream: true }),
		// Hard cap independent of the gateway, so a dead upstream fails fast
		// into the retry loop instead of hanging forever.
		signal: AbortSignal.timeout(10 * 60_000),
	});
	if (!res.ok) {
		const err = new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
		err.status = res.status;
		throw err;
	}
	/* Reassemble the SSE stream: each event is a line `data: {json}` whose
	 * delta carries the next fragment of the answer; `data: [DONE]` ends it.
	 * Empty-keepalive lines and `: comment` heartbeats are skipped. */
	/* Reassemble the SSE stream. Chunks arrive as Uint8Array at arbitrary
	 * boundaries, so buffer across chunks and split on newlines — a JSON
	 * event may straddle two chunks. Each event is `data: {json}` whose
	 * delta carries the next fragment; `data: [DONE]` ends the stream. */
	const decoder = new TextDecoder();
	let content = "";
	let buffer = "";
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const raw of lines) {
			const text = raw.trim();
			if (!text.startsWith("data:")) continue;
			const payload = text.slice(5).trim();
			if (payload === "[DONE]") return content.trim();
			try {
				const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
				if (delta) content += delta;
			} catch {
				/* unparseable event line — skip */
			}
		}
	}
	return content.trim();
}
async function chat(messages) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await chatOnce(messages);
		} catch (err) {
			const transient = err.status === undefined || RETRYABLE_STATUS.has(err.status);
			if (!transient || attempt >= 3) throw err;
			const waitMs = 2000 * 2 ** attempt;
			console.warn(`    api ${err.status ?? "network"}, retrying in ${waitMs / 1000}s…`);
			await new Promise((r) => setTimeout(r, waitMs));
		}
	}
}

/* Run async work over a list with a concurrency cap, preserving order. */
async function mapWithConcurrency(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}
const SEGMENT_CONCURRENCY = 6;

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

async function translateDescription(description, lang) {
	const system = `You are a professional translator. Translate the short project description of a developer's portfolio from Simplified Chinese into ${LANG_NAMES[lang]}. Return ONLY the translated description text — no quotes, no explanations. Preserve proper nouns, project names, and technology names as-is.`;
	const user = description;
	return chat([
		{ role: "system", content: system },
		{ role: "user", content: user },
	]);
}

async function translateBody(body, lang, extra = "") {
	const system = `You are a professional translator. Faithfully translate the following Markdown blog post from Simplified Chinese into ${LANG_NAMES[lang]}. Do NOT add, remove, merge, split, or expand any content — every heading, paragraph, list item, and code block in the input must appear exactly once in the output, in the same order. Preserve ALL Markdown syntax, headings, lists, links, images, inline code and code-block structure. Do NOT translate code syntax, shell commands, YAML/TOML keys, URLs, file paths, or regex patterns. Do translate human-readable Chinese inside config blocks (proxy group names, node names, rule names, comments). Translate the SAME source word or phrase the SAME way every time it appears — one source name must map to exactly one translated spelling across the whole document (a 'proxies:' or 'use:' list entry must match the 'name:' it points to, byte for byte). Keep the frontmatter out — translate only the body. Output ONLY the translated Markdown with no preamble or code fences.`;
	/* Line-count parity is the backbone of every positional check. State the
	 * exact number up front — models drift on line counts far less when the
	 * target is explicit instead of implied. */
	const user = `The input has exactly ${body.split("\n").length} lines. Your output MUST also have exactly ${body.split("\n").length} lines — one output line per input line, never merge or split lines.${extra ? ` ${extra}` : ""}\n\n${body}`;
	return chat([
		{ role: "system", content: system },
		{ role: "user", content: user },
	]);
}

/* Fenced code is not touched by translateBody, but some fences carry
 * human-readable text that should still be localized: mermaid diagram
 * labels and plain-text blocks (ascii flow charts, region lists).
 * They get dedicated passes that keep the block structure intact.
 * Plain-text blocks without any Chinese are left byte-for-byte identical
 * so version strings, paths and command output survive untouched. */
const MERMAID_BLOCK_RE = /```mermaid[^\n]*\n[\s\S]*?\n```/g;
const PLAIN_TEXT_BLOCK_RE = /```(?:text|txt|plaintext)[^\n]*\n[\s\S]*?\n```/g;
const HAS_CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/* Deterministic last resort for tiny blocks the model refuses to touch
 * (e.g. a proxy region list: 香港\n日本\n新加坡\n美国). After retries come
 * back unchanged, swap these fixed terms locally — but only adopt the
 * result if it clears every CJK character from the text. */
const CJK_TERM_DICT = {
	香港: "Hong Kong",
	台湾: "Taiwan",
	台灣: "Taiwan",
	日本: "Japan",
	新加坡: "Singapore",
	美国: "United States",
	美國: "United States",
	韩国: "Korea",
	韓國: "Korea",
	英国: "United Kingdom",
	英國: "United Kingdom",
	德国: "Germany",
	德國: "Germany",
	法国: "France",
	法國: "France",
	加拿大: "Canada",
	澳大利亚: "Australia",
	澳洲: "Australia",
	土耳其: "Turkey",
	阿根廷: "Argentina",
	巴西: "Brazil",
	印度: "India",
	俄罗斯: "Russia",
	俄羅斯: "Russia",
	荷兰: "Netherlands",
	荷蘭: "Netherlands",
	马来西亚: "Malaysia",
	泰国: "Thailand",
	泰國: "Thailand",
	越南: "Vietnam",
	菲律宾: "Philippines",
	印度尼西亚: "Indonesia",
	印尼: "Indonesia",
	中国: "China",
	中國: "China",
	澳门: "Macao",
	澳門: "Macao",
	国内: "Domestic",
	國內: "Domestic",
	国外: "Foreign",
	國外: "Foreign",
	广告: "Ads",
	廣告: "Ads",
	全球: "Global",
	手动: "Manual",
	自動: "Auto",
};
const CJK_TERM_RE = new RegExp(
	Object.keys(CJK_TERM_DICT)
		.sort((a, b) => b.length - a.length)
		.join("|"),
	"g",
);
function applyTermFallbackDict(text) {
	return text.replace(CJK_TERM_RE, (m) => CJK_TERM_DICT[m] ?? m);
}

function splitTranslatableSegments(body) {
	const scanners = [
		{ type: "mermaid", re: MERMAID_BLOCK_RE },
		{ type: "plaintext", re: PLAIN_TEXT_BLOCK_RE },
	];
	const segments = [];
	let last = 0;
	for (;;) {
		let best = null;
		for (const scanner of scanners) {
			scanner.re.lastIndex = last;
			const match = scanner.re.exec(body);
			if (match && (best === null || match.index < best.index)) {
				best = { type: scanner.type, index: match.index, content: match[0] };
			}
		}
		if (best === null) break;
		if (best.index > last) segments.push({ type: "text", content: body.slice(last, best.index) });
		segments.push(best);
		last = best.index + best.content.length;
	}
	if (last < body.length) segments.push({ type: "text", content: body.slice(last) });
	return segments;
}

/* The model sometimes wraps its answer in code fences despite instructions,
 * or leaks stray fence lines. Mermaid / plain-text block content can never
 * legitimately contain a fence, so drop every fence-looking line there.
 * For whole-body answers, strip one wrapping layer only. */
function stripStrayFenceLines(text) {
	return text
		.split("\n")
		.filter((line) => !/^[ \t]*`{3,}/.test(line))
		.join("\n");
}

function stripWrappingFences(text) {
	const match = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
	return match ? match[1] : text;
}

/* Per-segment structure guard: a drift that happens inside one segment used
 * to cost a whole-body retry (minutes). Catch it where it happens — the
 * translation of a segment must have exactly the same line, heading and
 * fence-marker count as its source. Fence markers matter as much as lines:
 * a segment that carries yaml/bash blocks gains stray ``` lines easily,
 * and one extra marker shifts every later fence pairing. Up to two
 * retranslations; the body-level checks stay as the final gate. */
async function translateSegmentWithGuard(content, lang) {
	/* The model always trims leading/trailing blank lines no matter what the
	 * prompt says. The caller already re-attaches the segment's whitespace
	 * padding (lead + translated + trail), so this guard compares trimmed
	 * line counts and must NOT add padding of its own — it would stack.
	 * (That stacking once inflated a whole document by ~70 lines.) */
	const stripBlank = (t) => t.replace(/^\n+/, "").replace(/\n+$/, "");
	const wantLines = stripBlank(content).split("\n").length;
	const wantHeadings = countHeadings(content);
	const wantFences = countFences(content);
	let translated = await translateBody(content, lang);
	for (let tryN = 0; tryN < 2; tryN++) {
		const gotLines = stripBlank(translated).split("\n").length;
		const gotHeadings = countHeadings(translated);
		const gotFences = countFences(translated);
		if (gotLines === wantLines && gotHeadings === wantHeadings && gotFences === wantFences) {
			return translated;
		}
		console.warn(
			`    segment drift: lines ${gotLines}/${wantLines}, headings ${gotHeadings}/${wantHeadings}, fences ${gotFences}/${wantFences} — retranslating (${content.split("\n")[0].slice(0, 40)})`,
		);
		translated = await translateBody(content, lang);
	}
	return translated;
}

/* Dedicated translation pass for one special block (mermaid or plain text),
 * with a retry if the model returns the input unchanged — that has happened
 * in practice and silently leaves Chinese labels in the output. */
async function translateBlockWithRetry(inner, lang, buildPrompt, rewrap) {
	for (let attempt = 0; ; attempt++) {
		const { system } = buildPrompt(lang);
		const raw = await chat([
			{ role: "system", content: system },
			{ role: "user", content: inner },
		]);
		const translated = rewrap(stripStrayFenceLines(stripWrappingFences(raw)));
		if (translated !== inner) return translated;
		if (attempt >= 1 && lang !== "ja") {
			const dicted = applyTermFallbackDict(inner);
			if (dicted !== inner && !HAS_CJK_RE.test(dicted)) {
				console.warn(
					`    block unchanged after retries — region-name dictionary applied (${inner.split("\n")[0].slice(0, 40)})`,
				);
				return dicted;
			}
			throw new Error("block translation returned the input unchanged");
		}
		console.warn(
			`    block translation came back unchanged, retrying… (${inner.split("\n")[0].slice(0, 40)}) raw=${JSON.stringify(raw).slice(0, 200)}`,
		);
	}
}

async function translateMermaid(block, lang) {
	const inner = block.replace(/^```mermaid[^\n]*\n/, "").replace(/\n```\s*$/, "");
	const translated = await translateBlockWithRetry(
		inner,
		lang,
		(l) => ({
			system: `You are a professional translator. Translate ONLY the human-readable label text inside this Mermaid diagram from Simplified Chinese into ${LANG_NAMES[l]}: text inside square brackets, curly braces, double quotes, edge labels like |text|, and notes. Keep EVERYTHING else byte-for-byte identical: diagram keywords (flowchart, graph, sequenceDiagram, etc.), node ids, arrows, brackets, semicolons, line breaks, and indentation. Do not add or remove lines. If the diagram has no Chinese at all, output it unchanged. Output ONLY the Mermaid code — no code fences, no explanations.`,
		}),
		(t) => t,
	);
	return "```mermaid\n" + translated + "\n```";
}

async function translateTextBlock(block, lang) {
	const open = block.match(/^```[^\n]*/)[0];
	const inner = block.slice(open.length + 1, block.length - 4);
	const translated = await translateBlockWithRetry(
		inner,
		lang,
		(l) => ({
			system: `Every Chinese word in the following plain-text block MUST be translated into ${LANG_NAMES[l]}. This is display text from a technical diagram, not code. Translate every Chinese word or phrase you see (for example 广告, 国内网站, 国外服务, 无法识别的流量, region and country names). Keep unchanged ONLY: line structure, blank lines, indentation, the arrows (↓ →), and Latin tokens such as REJECT, DIRECT, Proxy, domain names, paths, and version strings. Output ONLY the translated text — no code fences, no explanations.`,
		}),
		(t) => t,
	);
	return `${open}\n${translated}\n\`\`\``;
}

/** Translate a Markdown body, giving special blocks their dedicated passes. */
async function translateBodyWithBlocks(body, lang) {
	const segments = splitTranslatableSegments(body);
	/* Segments are independent — fan them out instead of paying one API
	 * round-trip per fence gap serially (a 128-fence post meant ~130 calls). */
	const translatedSegments = await mapWithConcurrency(
		segments,
		SEGMENT_CONCURRENCY,
		async (segment) => {
			const { content, type } = segment;
			// The model trims its output, so pure-whitespace separators between
			// blocks must survive untouched or fences end up glued to the text.
			if (!content.trim()) return content;
			const lead = content.match(/^\s*/)[0];
			const trail = content.match(/\s*$/)[0];
			let translated;
			if (type === "mermaid") {
				translated = HAS_CJK_RE.test(content) ? await translateMermaid(content, lang) : content;
			} else if (type === "plaintext") {
				translated = HAS_CJK_RE.test(content) ? await translateTextBlock(content, lang) : content;
			} else {
				translated = await translateSegmentWithGuard(content, lang);
			}
			return lead + translated + trail;
		},
	);
	return translatedSegments.join("");
}

/* Guard against model drift (the model once fabricated whole extra sections).
 * A faithful translation must mirror the source structure 1:1: same number
 * of headings and same number of fenced blocks. On drift, retry, then fail. */
function countHeadings(markdown) {
	return (markdown.match(/^#{1,6} /gm) ?? []).length;
}

function countFences(markdown) {
	return (markdown.match(/^[ \t]*```+/gm) ?? []).length;
}

/* Structural checks against hallucination: same headings, same fenced
 * blocks, similar length. */
function validateStructure(source, translated) {
	const headingCount = countHeadings(source);
	const translatedHeadingCount = countHeadings(translated);
	if (headingCount !== translatedHeadingCount) {
		throw new Error(
			`structure drift: ${headingCount} headings in source but ${translatedHeadingCount} in translation`,
		);
	}
	const fenceCount = countFences(source);
	const translatedFenceCount = countFences(translated);
	if (fenceCount !== translatedFenceCount) {
		throw new Error(
			`structure drift: ${fenceCount} fenced blocks in source but ${translatedFenceCount} in translation`,
		);
	}
	/* Line-count equality is the backbone of every positional check (the
	 * identifier dictionary, residual-CJK patching). The prompt forbids
	 * merging or splitting lines, so any difference is drift, not style. */
	const srcLineCount = source.split("\n").length;
	const outLineCount = translated.split("\n").length;
	if (srcLineCount !== outLineCount) {
		throw new Error(
			`structure drift: ${srcLineCount} lines in source but ${outLineCount} in translation`,
		);
	}
	if (translated.length < source.length * 0.4 || translated.length > source.length * 3) {
		throw new Error(
			`structure drift: translation length ${translated.length} vs source ${source.length}`,
		);
	}
}

/* Config display values (proxy group names, provider keys, rule targets)
 * must map one-to-one from the source Chinese into exactly one translated
 * spelling — the model sometimes renders 全部节点 as `all-nodes` in one
 * block and `All Nodes` in another, which breaks name↔reference consistency.
 * Structural validation guarantees both bodies have the same line count, so
 * we can pair lines positionally and build the identifier dictionary. */
function validateIdentifierConsistency(source, translated) {
	const sLines = source.split("\n");
	const tLines = translated.split("\n");
	const map = new Map();
	const record = (src, dst) => {
		const prev = map.get(src);
		if (prev !== undefined && prev !== dst) {
			throw new Error(`identifier inconsistency: "${src}" rendered both as "${prev}" and "${dst}"`);
		}
		map.set(src, dst);
	};
	const NAME_RE = /^(\s*)name:\s*(\S.*?)\s*$/;
	const KEY_RE = /^(\s*)(\S[^:#]*):\s*$/; // provider-style key: "  机场订阅:"
	const ITEM_RE = /^(\s*)-\s+(\S.*?)\s*$/; // proxies/use list item or rules line
	for (let i = 0; i < sLines.length; i++) {
		const s = sLines[i];
		const t = tLines[i] ?? "";
		let ms = s.match(NAME_RE);
		let mt = t.match(NAME_RE);
		if (ms && mt && HAS_CJK_RE.test(ms[2])) {
			record(ms[2], mt[2]);
			continue;
		}
		ms = s.match(KEY_RE);
		mt = t.match(KEY_RE);
		if (ms && mt && HAS_CJK_RE.test(ms[2])) {
			record(ms[2], mt[2]);
			continue;
		}
		ms = s.match(ITEM_RE);
		mt = t.match(ITEM_RE);
		if (ms && mt && HAS_CJK_RE.test(ms[2])) {
			record(ms[2], mt[2]);
		}
	}
}

/* For targets that do not use Han characters, most of the source's CJK text
 * must be gone — a near-identical CJK count means the model echoed the body. */
function validateCjkReduction(source, translated, lang) {
	if (["ja", "zh"].includes(lang)) return;
	const count = (text) => (text.match(/[\u3400-\u9fff]/g) ?? []).length;
	const srcCount = count(source);
	const outCount = count(translated);
	if (srcCount > 40 && outCount > srcCount * 0.5) {
		throw new Error(`untranslated content: ${outCount} of ${srcCount} CJK characters remain`);
	}
}

/* validateCjkReduction only fires when MORE than half the CJK survives —
 * scattered paragraphs the model echoed verbatim (a few headings, one or
 * two sentences) slip through it. For Latin-script targets any residual
 * Han text outside code fences is a bug, so collect those lines, group
 * them into clusters, re-translate each cluster (with a little source
 * context) as a mini document, and splice the lines back. Line counts are
 * preserved end to end; two patch rounds max, then give up to the caller.
 * Fenced lines are never touched — CJK inside config regexes is legit. */
async function patchResidualCjk(source, translated, lang) {
	if (lang === "zh" || lang === "zh-CN") return translated;
	const sLines = source.split("\n");
	const tLines = translated.split("\n");
	if (sLines.length !== tLines.length) return translated; // structure drift handled elsewhere

	const CJK_LINE_RE = /[\u3400-\u9fff]/;
	const FENCE_LINE_RE = /^[ \t]*(`{3,}|~{3,})/;
	/* Only these fenced-config shapes carry human-facing labels. This keeps
	 * regexes, URLs, paths and syntax untouched while still catching values
	 * such as `name: 全部节点`, `- 日本` and `MATCH,被墙网站`. */
	const isTranslatableConfigLine = (line) => {
		const text = line.trim();
		if (/^name:\s*\S/.test(text)) return true;
		if (/^[^:#]+:\s*$/.test(text) && CJK_LINE_RE.test(text)) return true;
		if (/^-\s+[^:]+$/.test(text) && CJK_LINE_RE.test(text)) return true;
		if (/^[A-Z][A-Z0-9-]*(?:,[^,]+)+$/.test(text) && CJK_LINE_RE.test(text)) return true;
		return false;
	};
	const JA_HOMOGRAPH_TERMS = new Set(["国内 DNS：", "内容：", "日本", "香港"]);
	const isJaHomographLine = (line) => {
		const text = line
			.trim()
			.replace(/^-\s+/, "")
			.replace(/^name:\s*/, "");
		return JA_HOMOGRAPH_TERMS.has(text);
	};
	/* Lines we already tried to fix. On the next scan they are skipped:
	 * Japanese legitimately reuses Han glyphs, so a patched line that came
	 * back byte-identical to the source (中日同形词 like 概要) is fine. */
	const patched = new Set();
	const scan = () => {
		const hits = [];
		let inFence = false;
		for (let i = 0; i < tLines.length; i++) {
			if (FENCE_LINE_RE.test(tLines[i])) {
				inFence = !inFence;
			} else if (!patched.has(i)) {
				const hasCjk = CJK_LINE_RE.test(tLines[i]);
				const residualForTarget = lang === "ja" ? tLines[i] === sLines[i] && hasCjk : hasCjk;
				const safeLocation = !inFence || isTranslatableConfigLine(sLines[i]);
				if (residualForTarget && safeLocation) hits.push(i);
			}
		}
		return hits;
	};

	const residual = scan();
	console.log(`    patch: ${residual.length} residual untranslated prose lines`);
	if (residual.length) {
		console.log(
			`    patch hits: ${residual.map((i) => `${i + 1}: ${JSON.stringify(tLines[i].slice(0, 50))}`).join("  |  ")}`,
		);
	}
	if (!residual.length) return translated;
	/* Fail closed: whether it is scattered (patchable) or a wide window of
	 * echo the CJK-reduction check cannot see, untranslated prose must never
	 * reach disk — throw and let the caller retry the whole body. */
	if (residual.length > 30) {
		throw new Error(`untranslated content: ${residual.length} prose lines echo the source`);
	}

	for (let round = 0; round < 2; round++) {
		const hits = scan();
		if (!hits.length) return tLines.join("\n");
		const clusters = [];
		for (const i of hits) {
			const last = clusters[clusters.length - 1];
			if (last && i - last.end <= 3) last.end = i;
			else clusters.push({ start: i, end: i });
		}
		for (const c of clusters) {
			const ctxStart = Math.max(0, c.start - 2);
			const ctxEnd = Math.min(sLines.length - 1, c.end + 2);
			const expected = ctxEnd - ctxStart + 1;
			const srcSlice = sLines.slice(ctxStart, ctxEnd + 1).join("\n");
			let fixed = null;
			const jaHomographCluster =
				lang === "ja" &&
				hits.filter((i) => i >= c.start && i <= c.end).every((i) => isJaHomographLine(tLines[i]));
			for (let tryN = 0; tryN < 2 && !fixed; tryN++) {
				/* The slice prompt must override the body prompt's "no code
				 * fences" — a slice often starts mid-document with a ```yaml
				 * block, and without this the model strips the fences (line
				 * count mismatch) or refuses the whole slice as "config". */
				const out = await translateBody(
					srcSlice,
					lang,
					"This input is a slice from a larger document. Keep ALL code fence lines (starting with ```), code content, punctuation and blank lines byte-for-byte. Translate ONLY the Chinese prose lines. Do NOT drop, add, or reorder any lines.",
				);
				if (out.trim() === srcSlice.trim()) {
					if (jaHomographCluster) {
						console.warn(
							`    patch slice ${ctxStart + 1}-${ctxEnd + 1}: echo accepted as known CJK homographs (ja)`,
						);
						fixed = srcSlice.split("\n");
						break;
					}
					console.warn(
						`    patch slice ${ctxStart + 1}-${ctxEnd + 1}: model echoed the source, retrying…`,
					);
					continue;
				}
				const outLines = out.split("\n");
				if (outLines.length === expected) fixed = outLines;
				else
					console.warn(
						`    patch slice ${ctxStart + 1}-${ctxEnd + 1}: line count ${outLines.length} != ${expected}, retrying…`,
					);
			}
			if (!fixed && lang !== "ja") {
				/* Region-name style leftovers the model keeps echoing: the
				 * deterministic dictionary is the last resort, only if it clears
				 * every CJK character from the slice. English-only: its mappings
				 * are English and would corrupt a Japanese translation. */
				const dicted = applyTermFallbackDict(srcSlice).split("\n");
				if (!dicted.some((l) => HAS_CJK_RE.test(l))) fixed = dicted;
			}
			if (!fixed)
				throw new Error(
					`residual patch failed: could not re-translate lines ${ctxStart + 1}-${ctxEnd + 1} with matching line count`,
				);
			for (let i = c.start; i <= c.end; i++) {
				tLines[i] = fixed[i - ctxStart];
				patched.add(i);
			}
		}
	}
	throw new Error("residual untranslated prose still present after two patch rounds");
}

async function translateBodyWithBlocksValidated(body, lang) {
	for (let attempt = 0; ; attempt++) {
		let translated;
		try {
			translated = await translateBodyWithBlocks(body, lang);
			validateStructure(body, translated);
			validateCjkReduction(body, translated, lang);
			translated = await patchResidualCjk(body, translated, lang);
			validateStructure(body, translated);
			validateIdentifierConsistency(body, translated);
			return translated;
		} catch (err) {
			if (translated) {
				try {
					fs.writeFileSync(`/tmp/translate-drift-${lang}-${attempt}.md`, translated);
					console.warn(`    output saved to /tmp/translate-drift-${lang}-${attempt}.md`);
				} catch {
					/* best effort */
				}
			}
			if (attempt >= 2) throw err;
			console.warn(`    structure check failed, retrying… (${err.message})`);
		}
	}
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
	if (!data.lang || ["zh-CN", "zh"].includes(data.lang)) {
		// Never translate unpublished work-in-progress posts.
		if (data.draft === true) {
			console.log(`skip   ${srcPath} (draft)`);
			continue;
		}
	} else {
		console.log(`skip   ${srcPath} (lang=${data.lang}, not Simplified Chinese)`);
		continue;
	}

	const rel = srcPath.slice(POSTS_DIR.length + 1);
	const ext = extname(rel);
	const slug = rel.slice(0, -ext.length);
	const hash = sha256(srcRaw);

	const validTargets = TARGETS.filter((target) => {
		if (!LANG_NAMES[target]) {
			console.warn(
				`unknown target language "${target}" — add it to i18nConfig.locales in src/site.config.ts (skipped)`,
			);
			return false;
		}
		return true;
	});
	/* Both target languages run at once — they are fully independent. */
	await mapWithConcurrency(validTargets, validTargets.length, async (target) => {
		const outPath = join(TRANS_DIR, target, `${slug}${ext}`);
		const existingRaw = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
		const existingHash = existingRaw ? splitFrontmatter(existingRaw).data.sourceHash : null;

		if (!FORCE && existingHash === hash) {
			console.log(`ok     [${target}] ${rel} (up to date)`);
			skipped++;
			return;
		}

		if (DRY) {
			console.log(`would  [${target}] ${rel}`);
			return;
		}

		try {
			const meta = await translateMeta(data.title, data.description ?? "", target);
			const newBody = await translateBodyWithBlocksValidated(body, target);

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
	});
}

/* ---------------- projects ----------------
 * Project records only need their `description` localized; everything else
 * (name, repository, tech stack, dates) is language-neutral. Translations
 * land at content/translations/<lang>/projects/<slug>.md and are picked up
 * by the `projectTranslation` content collection. */
const projectSources = walk(PROJECTS_DIR);
for (const srcPath of projectSources) {
	const srcRaw = readFileSync(srcPath, "utf8");
	const { data } = splitFrontmatter(srcRaw);
	if (!data.description) continue;

	const rel = srcPath.slice(PROJECTS_DIR.length + 1);
	const ext = extname(rel);
	const slug = rel.slice(0, -ext.length);
	const hash = sha256(srcRaw);

	for (const target of TARGETS) {
		if (!LANG_NAMES[target]) continue;
		const outPath = join(TRANS_DIR, target, "projects", `${slug}${ext}`);
		const existingRaw = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
		const existingHash = existingRaw ? splitFrontmatter(existingRaw).data.sourceHash : null;

		if (!FORCE && existingHash === hash) {
			console.log(`ok     [${target}] projects/${rel} (up to date)`);
			skipped++;
			continue;
		}

		if (DRY) {
			console.log(`would  [${target}] projects/${rel}`);
			continue;
		}

		try {
			const description = await translateDescription(data.description, target);
			const outMeta = {
				description,
				lang: target,
				source: `projects/${slug}`,
				sourceHash: hash,
			};
			const fm = yaml.dump(outMeta).trimEnd();
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, `---\n${fm}\n---\n`);
			console.log(`wrote  [${target}] projects/${rel}`);
			done++;
		} catch (err) {
			console.error(`error  [${target}] projects/${rel}: ${err.message}`);
			failed++;
		}
	}
}

console.log(`\nTranslated ${done}, up-to-date ${skipped}, failed ${failed}.`);
if (failed) process.exitCode = 1;
