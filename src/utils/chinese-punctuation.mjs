const CJK = /[\u3400-\u9fff]/;
const ASCII_TOKEN = /[A-Za-z0-9_]/;
const PROTECTED_TOKEN = "\u0000";

function protect(text) {
	const values = [];
	const patterns = [
		// Image alt text never becomes a text node, so the whole construct is inert.
		/!\[[^\]\n]*\]\((?:\\.|[^()\n])*\)/g,
		/`+[^`]*`+/g,
		/\]\((?:\\.|[^()\n])*\)/g,
		// Definition labels are consumed by the Markdown parser, not rendered.
		/\[\^[^\]\n]+\]:/g,
		/(?:^|\n) {0,3}\[[^\]\n]+\]:/g,
		// Ordered list markers (`1. `, `1) `) never reach a text node either.
		/(?:^|\n) {0,3}\d+[.)](?=[ \t])/g,
		// `:::tip` and `::github{...}` are directives, not prose.
		/(?:^|\n) {0,3}:{2,}[a-z-]+(?:\{[^}\n]*\})?/gi,
		/https?:\/\/[^\s<>()]+/gi,
		/\bwww\.[^\s<>()]+/gi,
		/<[^>\n]+>/g,
	];
	let result = text;

	for (const pattern of patterns) {
		result = result.replace(pattern, (value) => {
			const index = values.push(value) - 1;
			return `${PROTECTED_TOKEN}${index}${PROTECTED_TOKEN}`;
		});
	}

	return { result, values };
}

function restore(text, values) {
	return text.replace(/\u0000(\d+)\u0000/g, (_, index) => values[Number(index)]);
}

function hasChineseText(text) {
	return CJK.test(text);
}

/** ASCII punctuation → the full-width mark it should be in Chinese prose. */
const PUNCTUATION_MAP = new Map([
	[",", "，"],
	["!", "！"],
	["?", "？"],
	[";", "；"],
	[":", "："],
	[".", "。"],
]);

/**
 * Only the marks that state a *converted* punctuation position live in the
 * mask. Whitespace next to a marked position is authored spacing that the
 * conversion absorbed, so it gets dropped; whitespace next to a mark the
 * author typed as full-width already stays untouched.
 */
function replaceTracked(state, pattern, replacer) {
	const text = state.text;
	const parts = [];
	const mask = [];
	let last = 0;

	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		parts.push(text.slice(last, start));
		for (let index = last; index < start; index++) mask.push(state.mask[index]);

		const { text: replacement, converted } = replacer(match);
		for (let index = 0; index < replacement.length; index++) {
			mask.push(converted.includes(index) ? 1 : 0);
		}
		parts.push(replacement);

		last = start + match[0].length;
	}

	parts.push(text.slice(last));
	for (let index = last; index < text.length; index++) mask.push(state.mask[index]);

	return { text: parts.join(""), mask: Uint8Array.from(mask) };
}

/** Keep `1,000`, `10:30`, `v1.19.30` and `config.yaml` half-width. */
function keepsAsciiForm(char, previous, next) {
	if (/\d/.test(previous) && /\d/.test(next)) return true;
	if (char === "." && ASCII_TOKEN.test(previous) && ASCII_TOKEN.test(next)) return true;
	return false;
}

/** Chunked so a huge text node cannot overflow the argument stack. */
function codesToString(codes) {
	const CHUNK = 4096;
	let text = "";
	for (let index = 0; index < codes.length; index += CHUNK) {
		text += String.fromCharCode(...codes.subarray(index, index + CHUNK));
	}
	return text;
}

function convertPunctuation(text) {
	const out = new Int32Array(text.length);
	const mask = new Uint8Array(text.length);

	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		const replacement = PUNCTUATION_MAP.get(char);
		if (replacement === undefined || keepsAsciiForm(char, text[index - 1] ?? "", text[index + 1] ?? "")) {
			out[index] = char.charCodeAt(0);
			mask[index] = 0;
			continue;
		}
		out[index] = replacement.charCodeAt(0);
		mask[index] = 1;
	}

	return { text: codesToString(out), mask };
}

/**
 * Drop whitespace that sits against a converted full-width mark: `, ` → `，`,
 * ` ,` → `，`, `,\n` → `，`. A run spanning more than one newline is kept so
 * paragraph structure can never be collapsed.
 */
function absorbSpacing({ text, mask }) {
	const parts = [];
	let index = 0;

	while (index < text.length) {
		if (!/\s/.test(text[index])) {
			parts.push(text[index]);
			index += 1;
			continue;
		}

		let end = index;
		let newlines = text[index] === "\n" ? 1 : 0;
		while (end + 1 < text.length && /\s/.test(text[end + 1])) {
			end += 1;
			if (text[end] === "\n") newlines += 1;
		}

		// Leading whitespace is block structure (list continuation, indentation),
		// never spacing the conversion introduced, so it is always kept.
		const absorbed = mask[index - 1] === 1 || (index > 0 && mask[end + 1] === 1);
		if (!absorbed || newlines > 1) parts.push(text.slice(index, end + 1));
		index = end + 1;
	}

	return parts.join("");
}

/**
 * A parenthetical split by inline markup (`Q20(… `code` `… 还是`) reaches the
 * plugin as two text nodes, so the pair rule above never fires. Any paren left
 * unbalanced inside one node is such a split half, and a balanced pair without
 * CJK inside (`(Swift)`) is left half-width.
 */
function convertUnbalancedParens(state) {
	const unmatched = new Set();
	const open = [];

	for (let index = 0; index < state.text.length; index++) {
		const char = state.text[index];
		if (char === "(") open.push(index);
		else if (char === ")") {
			if (open.length > 0) open.pop();
			else unmatched.add(index);
		}
	}
	for (const index of open) unmatched.add(index);
	if (unmatched.size === 0) return state;

	const chars = state.text.split("");
	const mask = Uint8Array.from(state.mask);
	for (const index of unmatched) {
		chars[index] = chars[index] === "(" ? "（" : "）";
		mask[index] = 1;
	}

	return { text: chars.join(""), mask };
}

function convertText(text, allowStandalonePunctuation = false) {
	if (!allowStandalonePunctuation && !hasChineseText(text)) return text;

	let state = { text, mask: new Uint8Array(text.length) };

	// `...` → `……`
	state = replaceTracked(state, /\.\.\./g, () => ({ text: "……", converted: [0, 1] }));

	// `"文字"` → `“文字”`, `'文字'` → `‘文字’`
	state = replaceTracked(state, /"([^"\n]*[\u3400-\u9fff][^"\n]*)"/g, (match) => ({
		text: `“${match[1]}”`,
		converted: [0, match[1].length + 1],
	}));
	state = replaceTracked(state, /'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g, (match) => ({
		text: `‘${match[1]}’`,
		converted: [0, match[1].length + 1],
	}));

	// `(文字)` → `（文字）`. The split is decided by the content, not by what
	// precedes the paren, so `Term49C(在 …)` becomes full-width too.
	state = replaceTracked(state, /\(([^()\n]*[\u3400-\u9fff][^()\n]*)\)/g, (match) => ({
		text: `（${match[1]}）`,
		converted: [0, match[1].length + 1],
	}));

	state = convertUnbalancedParens(state);

	const punctuation = convertPunctuation(state.text);
	const merged = new Uint8Array(punctuation.mask.length);
	for (let index = 0; index < merged.length; index++) {
		merged[index] = punctuation.mask[index] === 1 || state.mask[index] === 1 ? 1 : 0;
	}

	return absorbSpacing({ text: punctuation.text, mask: merged });
}

/**
 * Full-width marks whose canonical *source* spelling is half-width. Markdown
 * source keeps the author's typing habit and the renderer turns it into the
 * full-width form, so the two spellings must round-trip.
 *
 * `space: true` marks separate clauses and take one space after them;
 * `space: false` marks hug their content (`文字(说明)` → `文字（说明）`).
 *
 * Left alone on purpose: `、` `——` `……` have no half-width equivalent, and
 * quotes stay full-width because Markdown's `smartypants` pass rewrites ASCII
 * `"` before any plugin sees it (and picks the wrong closing mark next to `)`).
 */
const SOURCE_SPELLING = new Map([
	["，", { mark: ",", space: true }],
	["。", { mark: ".", space: true }],
	["！", { mark: "!", space: true }],
	["？", { mark: "?", space: true }],
	["；", { mark: ";", space: true }],
	["：", { mark: ":", space: true }],
	["（", { mark: "(", space: false }],
	["）", { mark: ")", space: false }],
]);

const SPACE = /[ \t]/;

/**
 * Parens only go half-width in source when the renderer will turn them back:
 * a pair whose content holds CJK, or a split half. A balanced Latin pair such
 * as `（Hotspot Login）` has no Chinese inside, so it stays full-width.
 */
function convertibleParens(text) {
	const convertible = new Set();
	const stack = [];

	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "（") stack.push(index);
		else if (char === "）") {
			if (stack.length === 0) {
				convertible.add(index);
				continue;
			}
			const open = stack.pop();
			if (CJK.test(text.slice(open + 1, index))) {
				convertible.add(open);
				convertible.add(index);
			}
		}
	}
	for (const index of stack) convertible.add(index);

	return convertible;
}

function sourceSpelling(text) {
	const parens = convertibleParens(text);
	const parts = [];
	let addedTrailingSpace = false;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if ((char === "（" || char === "）") && !parens.has(index)) {
			parts.push(char);
			addedTrailingSpace = false;
			continue;
		}

		const spelling = SOURCE_SPELLING.get(char);

		if (spelling === undefined) {
			parts.push(char);
			addedTrailingSpace = false;
			continue;
		}

		// Never leave whitespace in front of a mark, and fold whatever already
		// follows it into the one space this spelling adds.
		while (parts.length > 0 && SPACE.test(parts.at(-1))) parts.pop();
		while (index + 1 < text.length && SPACE.test(text[index + 1])) index += 1;

		if (spelling.space) {
			parts.push(`${spelling.mark} `);
			addedTrailingSpace = true;
		} else {
			parts.push(spelling.mark);
			addedTrailingSpace = false;
		}
	}

	// A mark that ends the line keeps its half-width form but not the space.
	if (addedTrailingSpace) parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
	return parts.join("");
}

/** Convert conservative English punctuation in Chinese prose. */
export function convertChinesePunctuation(text, allowStandalonePunctuation = false) {
	const { result, values } = protect(text);
	return restore(convertText(result, allowStandalonePunctuation), values);
}

/** Rewrite full-width marks as the half-width + space spelling used in source. */
export function toChineseSourcePunctuation(text) {
	const { result, values } = protect(text);
	return restore(sourceSpelling(result), values);
}

/** Whether the text contains punctuation that would be converted. */
export function hasChinesePunctuationIssues(text) {
	return convertChinesePunctuation(text) !== text;
}

/** Whether the text already uses the half-width + space source spelling. */
export function hasSourcePunctuationIssues(text) {
	return toChineseSourcePunctuation(text) !== text;
}
