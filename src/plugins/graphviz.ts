import type { MdastPluginDefinition } from "satteri";
import { h } from "../utils/remark";

/**
 * Converts ```dot / ```graphviz code blocks into raw `<pre class="graphviz">`
 * blocks so they bypass expressive-code and can be rendered client-side by the
 * viz-js WASM library.
 *
 * The `data-graphviz` marker lets the frontend script find blocks that were
 * compiled from markdown (as opposed to hand-written HTML).
 */
export function satteriGraphvizPlugin(): MdastPluginDefinition {
	return {
		name: "cactus-graphviz",
		code(node) {
			if (node.lang !== "dot" && node.lang !== "graphviz") return;
			// Keep the raw DOT source inside the <pre> — the renderer reads its text content.
			return h(
				"pre",
				{ class: "graphviz", "data-graphviz": "" },
				[{ type: "text", value: node.value }],
			);
		},
	};
}