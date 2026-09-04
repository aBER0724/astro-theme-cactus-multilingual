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

/** URL for a project detail anchor in the current UI locale. */
export function getProjectHref(project: CollectionEntry<"project">, locale: "zh" | Locale): string {
	const prefix = locale === "zh" ? "" : `/${locale}`;
	return `${prefix}/projects/#${project.id}`;
}
