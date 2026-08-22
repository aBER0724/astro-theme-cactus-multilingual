import type { MdastPluginDefinition } from "satteri";
import { h } from "../utils/remark";

/**
 * Converts ```mermaid code blocks into raw `<pre class="mermaid">` blocks
 * so they bypass expressive-code and can be rendered client-side by the
 * mermaid library.
 *
 * The `data-mermaid` marker lets the frontend script find blocks that were
 * compiled from markdown (as opposed to hand-written HTML).
 */
export function satteriMermaidPlugin(): MdastPluginDefinition {
	return {
		name: "cactus-mermaid",
		code(node) {
			if (node.lang !== "mermaid") return;
			// Keep the raw source inside the <pre> — mermaid.run() reads its text content.
			return h(
				"pre",
				{ class: "mermaid", "data-mermaid": "" },
				[{ type: "text", value: node.value }],
			);
		},
	};
}