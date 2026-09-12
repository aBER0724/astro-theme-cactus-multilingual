import type { HastPluginDefinition } from "satteri";
import { convertChinesePunctuation } from "../utils/chinese-punctuation.mjs";

export function satteriChinesePunctuationPlugin(): HastPluginDefinition {
	return {
		name: "cactus-chinese-punctuation",
		text(node, ctx) {
			let parent = ctx.parent(node);
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
