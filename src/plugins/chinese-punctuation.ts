import type { HastPluginDefinition } from "satteri";
import { convertChinesePunctuation } from "../utils/chinese-punctuation.mjs";

/**
 * Whether the document being processed is Chinese prose. Translated entries
 * carry their own `lang`, so English and Japanese pages must render with the
 * punctuation their translators wrote — converting them produced `，`/`。` in
 * the middle of English sentences.
 */
function isChineseDocument(ctx: { data: Record<string, unknown> }): boolean {
	const frontmatter = (ctx.data as { astro?: { frontmatter?: Record<string, unknown> } }).astro?.frontmatter;
	const lang = frontmatter?.lang;
	return typeof lang === "string" ? lang.startsWith("zh") : true;
}

export function satteriChinesePunctuationPlugin(): HastPluginDefinition {
	return {
		name: "cactus-chinese-punctuation",
		text(node, ctx) {
			if (!isChineseDocument(ctx)) return undefined;

			// `ctx.parent` is overloaded: the element form returns a parent, the
			// generic one can return `undefined` at the root. Annotate once so the
			// loop keeps the looser type instead of narrowing to the first overload.
			let parent: ReturnType<typeof ctx.parent> = ctx.parent(node);
			while (parent) {
				if (parent.type === "element" && (parent.tagName === "code" || parent.tagName === "pre")) {
					return undefined;
				}
				parent = ctx.parent(parent);
			}

			const value = convertChinesePunctuation(node.value, true);
			return value === node.value ? undefined : { ...node, value };
		},
	};
}
