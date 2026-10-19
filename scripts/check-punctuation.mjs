#!/usr/bin/env node
/**
 * Keeps Chinese post sources in one spelling and the rendered page in another.
 *
 * - Body prose is written as half-width punctuation + one space (`文字, 文字`).
 *   A `satteri` plugin converts it to `文字，文字` while rendering, so the
 *   source keeps the author's typing habit.
 * - Frontmatter is not markdown, so its double-quoted values must already be
 *   full-width — `description` goes straight into meta tags and social cards.
 *
 * `--fix` rewrites the source; `--strict` exits non-zero when anything is left.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	hasChinesePunctuationIssues,
	hasSourcePunctuationIssues,
	toChineseSourcePunctuation,
	convertChinesePunctuation,
} from "../src/utils/chinese-punctuation.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POSTS_DIR = path.join(ROOT, "content", "posts");
const STRICT = process.argv.includes("--strict");
const FIX = process.argv.includes("--fix");

async function walk(directory) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(file)));
		else if (/\.(md|mdx)$/.test(entry.name)) files.push(file);
	}
	return files;
}

function getSourceLanguage(source) {
	const match = source.match(/^lang:\s*["']?([^"'\s]+)["']?/m);
	return match?.[1] ?? "zh-CN";
}

function splitFrontmatter(source) {
	if (!source.startsWith("---")) return { frontmatter: "", body: source };
	const end = source.indexOf("\n---", 3);
	if (end < 0) return { frontmatter: "", body: source };
	return { frontmatter: source.slice(0, end + "\n---".length), body: source.slice(end + "\n---".length) };
}

/**
 * CommonMark fence tracking: a fence closes only on a marker of the same
 * character that is at least as long and carries no info string. Naive
 * open/close toggling desynchronises on nested ```` ```` ``` ```` examples.
 */
function fenceScanner() {
	let open = null;

	return (line) => {
		const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (open === null) {
			if (!match) return false;
			open = match[1];
			return true;
		}
		if (match && match[1][0] === open[0] && match[1].length >= open.length && match[2].trim() === "") {
			open = null;
		}
		return true;
	};
}

function findBodyIssues(body, offset) {
	const issues = [];
	const inFence = fenceScanner();

	for (const [index, line] of body.split(/\r?\n/).entries()) {
		if (inFence(line)) continue;
		if (hasSourcePunctuationIssues(line)) issues.push(index + offset);
	}

	return issues;
}

/** Frontmatter is YAML, so only double-quoted scalars are safe to rewrite. */
function findFrontmatterIssues(frontmatter) {
	const issues = [];
	for (const [index, line] of frontmatter.split(/\r?\n/).entries()) {
		for (const [, value] of line.matchAll(/"([^"\n]*)"/g)) {
			if (hasChinesePunctuationIssues(value)) issues.push(index + 1);
		}
	}
	return issues;
}

function frontmatterLineCount(frontmatter) {
	return frontmatter ? frontmatter.split("\n").length : 0;
}

function fixFrontmatter(frontmatter) {
	return frontmatter.replace(/"([^"\n]*)"/g, (match, value) => {
		const fixed = convertChinesePunctuation(value);
		return fixed === value ? match : `"${fixed}"`;
	});
}

function fixBody(body) {
	const inFence = fenceScanner();

	return body
		.split("\n")
		.map((line) => (inFence(line) ? line : toChineseSourcePunctuation(line)))
		.join("\n");
}

function fixSource(source) {
	const { frontmatter, body } = splitFrontmatter(source);
	return fixFrontmatter(frontmatter) + fixBody(body);
}

const files = (await walk(POSTS_DIR)).sort();
let issueCount = 0;
let fixedCount = 0;

for (const file of files) {
	const source = await fs.readFile(file, "utf8");
	if (!getSourceLanguage(source).startsWith("zh")) continue;

	const output = FIX ? fixSource(source) : source;
	const changed = output !== source;
	if (FIX && changed) {
		await fs.writeFile(file, output, "utf8");
		fixedCount += 1;
	}

	const { frontmatter, body } = splitFrontmatter(output);
	const issues = [
		...findFrontmatterIssues(frontmatter),
		...findBodyIssues(body, frontmatterLineCount(frontmatter)),
	];

	if (issues.length) {
		issueCount += issues.length;
		console.log(`${path.relative(ROOT, file)}: ${issues.map((line) => `line ${line}`).join(", ")}`);
	} else if (FIX && changed) {
		console.log(`${path.relative(ROOT, file)}: fixed`);
	}
}

if (issueCount) {
	console.log(`\nFound ${issueCount} line(s) whose punctuation spelling is not canonical.`);
	console.log(
		FIX
			? "Some lines still deviate — rerun with --fix."
			: "Run with --fix to rewrite the source (body: half-width + space, frontmatter: full-width).",
	);
	if (STRICT) process.exitCode = 1;
} else {
	console.log(
		fixedCount ? `Fixed punctuation in ${fixedCount} file(s).` : "Chinese post punctuation matches the source spelling.",
	);
}
