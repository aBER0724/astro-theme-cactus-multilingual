#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { hasChinesePunctuationIssues } from "../src/utils/chinese-punctuation.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const POSTS_DIR = path.join(ROOT, "content", "posts");
const STRICT = process.argv.includes("--strict");

function getSourceLanguage(source) {
	const match = source.match(/^lang:\s*["']?([^"'\s]+)["']?/m);
	return match?.[1] ?? "zh-CN";
}

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

function splitFrontmatter(source) {
	if (!source.startsWith("---")) return source;
	const end = source.indexOf("\n---", 3);
	return end < 0 ? source : source.slice(end + "\n---".length);
}

function findIssues(body) {
	const issues = [];
	let inFence = false;

	for (const [index, line] of body.split(/\r?\n/).entries()) {
		if (/^\s*(`{3,}|~{3,})/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence && hasChinesePunctuationIssues(line)) issues.push(index + 1);
	}

	return issues;
}

const files = (await walk(POSTS_DIR)).sort();
let issueCount = 0;

for (const file of files) {
	const source = await fs.readFile(file, "utf8");
	const language = getSourceLanguage(source);
	if (!language.startsWith("zh")) continue;

	const issues = findIssues(splitFrontmatter(source));
	if (!issues.length) continue;

	issueCount += issues.length;
	console.log(`${path.relative(ROOT, file)}: ${issues.map((line) => `line ${line}`).join(", ")}`);
}

if (issueCount) {
	console.log(`\nFound ${issueCount} line(s) with punctuation that will be converted during rendering.`);
	if (STRICT) process.exitCode = 1;
} else {
	console.log("No convertible English punctuation found in Chinese posts.");
}
