#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const POSTS_DIR = path.resolve("content/posts");

function slugify(value) {
	return value
		.normalize("NFKD")
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function quoteYaml(value) {
	return JSON.stringify(value);
}

function parseTags(value) {
	return [
		...new Set(
			value
				.split(/[,，]/)
				.map((tag) => tag.trim().toLowerCase())
				.filter(Boolean),
		),
	];
}

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function createPrompter() {
	if (process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		return {
			ask: (question) => rl.question(question),
			close: () => rl.close(),
		};
	}

	process.stdin.setEncoding("utf8");
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	const answers = input.split(/\r?\n/);
	let index = 0;
	return {
		ask: async (question) => {
			process.stdout.write(question);
			const answer = answers[index++] ?? "";
			process.stdout.write(`${answer}\n`);
			return answer;
		},
		close: () => {},
	};
}

const prompt = await createPrompter();

try {
	const title = (await prompt.ask("文章标题：")).trim();
	if (!title) throw new Error("文章标题不能为空。");
	if (title.length > 60) throw new Error("文章标题不能超过 60 个字符。");

	const suggestedSlug = slugify(title);
	const slugInput = (
		await prompt.ask(`文件名/slug${suggestedSlug ? `（默认 ${suggestedSlug}）` : ""}：`)
	).trim();
	const slug = slugify(slugInput || suggestedSlug);
	if (!slug) throw new Error("请输入仅含英文、数字或连字符的文件名/slug。");

	const description = (await prompt.ask("文章描述：")).trim();
	if (!description) throw new Error("文章描述不能为空。");

	const tags = parseTags(await prompt.ask("标签（逗号分隔，可留空）："));
	const filePath = path.join(POSTS_DIR, `${slug}.md`);
	if (await exists(filePath))
		throw new Error(`文件已存在：${path.relative(process.cwd(), filePath)}`);

	const frontmatter = [
		"---",
		`title: ${quoteYaml(title)}`,
		`description: ${quoteYaml(description)}`,
		`publishDate: ${new Date().toISOString()}`,
		"lang: zh-CN",
		...(tags.length ? ["tags:", ...tags.map((tag) => `  - ${quoteYaml(tag)}`)] : ["tags: []"]),
		"draft: true",
		"---",
		"",
		"",
	].join("\n");

	await mkdir(POSTS_DIR, { recursive: true });
	await writeFile(filePath, frontmatter, { encoding: "utf8", flag: "wx" });

	console.log(`\n已创建：${path.relative(process.cwd(), filePath)}`);
	console.log(`预览：pnpm dev → http://localhost:4321/posts/${slug}/`);
	console.log("发布前请将 draft 改为 false。");
} catch (error) {
	console.error(`\n创建失败：${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	prompt.close();
}
