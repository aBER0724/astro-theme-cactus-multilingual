import { type CollectionEntry, getCollection } from "astro:content";
import type { Locale } from "@/data/post";

/** Pinned projects first, then newest start month first. */
export async function getAllProjects(): Promise<CollectionEntry<"project">[]> {
	return (await getCollection("project")).sort((a, b) => {
		if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
		const byStartDate = b.data.startDate.localeCompare(a.data.startDate);
		return byStartDate || a.data.name.localeCompare(b.data.name);
	});
}

export function formatProjectStartDate(startDate: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(
		new Date(`${startDate}-01T00:00:00Z`),
	);
}

/**
 * Localized project descriptions for one UI locale, keyed by project id.
 * Falls back to the source (Chinese) description at render time when a
 * project has no translation yet, so callers can pass the map straight
 * into <ProjectCard>.
 */
export async function getProjectDescriptions(locale: Locale): Promise<Map<string, string>> {
	const entries = await getCollection(
		"projectTranslation",
		({ data }) => data.lang === locale,
	);
	return new Map(
		entries.map((entry) => {
			// Mirror posts: `source` is "projects/<slug>". Fall back to the id
			// suffix for hand-written files without source frontmatter.
			const slug = (entry.data.source ?? `projects/${entry.id}`).replace(/^projects\//, "");
			return [slug, entry.data.description];
		}),
	);
}

/** URL for a project detail anchor in the current UI locale. */
export function getProjectHref(project: CollectionEntry<"project">, locale: "zh" | Locale): string {
	const prefix = locale === "zh" ? "" : `/${locale}`;
	return `${prefix}/projects/#${project.id}`;
}
