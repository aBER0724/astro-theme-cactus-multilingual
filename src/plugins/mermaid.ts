import type { MdastPluginDefinition } from "satteri";
import { h } from "../utils/remark";

/**
 * Converts ```mermaid code blocks into raw `<pre class="mermaid">` blocks so
 * they bypass expressive-code and are drawn client-side by pele (a renderer
 * for Mermaid syntax).
 *
 * The class name keeps the source language: the fenced block is still written
 * as ```mermaid, and `pre.mermaid` is what the renderer and the theme CSS both
 * target.
 */
export function satteriMermaidPlugin(): MdastPluginDefinition {
	return {
		name: "cactus-mermaid",
		code(node) {
			if (node.lang !== "mermaid") return;
			// Keep the raw source inside the <pre> — the renderer reads its text content.
			return h("pre", { class: "mermaid" }, [{ type: "text", value: node.value }]);
		},
	};
}