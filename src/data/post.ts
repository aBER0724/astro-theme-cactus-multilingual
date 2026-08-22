import { type CollectionEntry, getCollection } from "astro:content";
import { i18nConfig } from "@/site.config";

// Translation target languages, derived from site.config.ts → i18nConfig.translateTo.
// translationLocales is the same runtime value, for getStaticPaths loops.
export type Locale = (typeof i18nConfig.translateTo)[number];
export const translationLocales: readonly Locale[] = i18nConfig.translateTo;

/** filter out draft posts based on the environment */
export async function getAllPosts(): Promise<CollectionEntry<"post">[]> {
	return await getCollection("post", ({ data }) => {
		return import.meta.env.PROD ? !data.draft : true;
	});
}

/**
 * Source posts (of any language) that have an approved translation in the
 * given locale, paired with their translation entry so callers can render
 * the localized title/description and link to /{locale}/{slug}/.
 */
export async function getPostsForLocale(
	locale: Locale,
): Promise<{ post: CollectionEntry<"post">; trans: CollectionEntry<"translation"> }[]> {
	const translations = await getCollection("translation", ({ data }) => {
		return data.lang === locale && (import.meta.env.PROD ? !data.draft : true);
	});
	const bySlug = new Map(translations.map((t) => [t.data.source.replace(/^posts\//, ""), t]));
	const posts = await getAllPosts();
	const result: { post: CollectionEntry<"post">; trans: CollectionEntry<"translation"> }[] = [];
	for (const post of posts) {
		const trans = bySlug.get(post.id);
		if (trans) result.push({ post, trans });
	}
	return result;
}

/** Get tag metadata by tag name */
export async function getTagMeta(tag: string): Promise<CollectionEntry<"tag"> | undefined> {
	const tagEntries = await getCollection("tag", (entry) => {
		return entry.id === tag;
	});
	return tagEntries[0];
}

/** groups posts by year (based on option siteConfig.sortPostsByUpdatedDate), using the year as the key
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 */
export function groupPostsByYear(posts: CollectionEntry<"post">[]) {
	return Object.groupBy(posts, (post) => post.data.publishDate.getFullYear().toString());
}

/** returns all tags created from posts (inc duplicate tags)
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getAllTags(posts: CollectionEntry<"post">[]) {
	return posts.flatMap((post) => [...post.data.tags]);
}

/** returns all unique tags created from posts
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getUniqueTags(posts: CollectionEntry<"post">[]) {
	return [...new Set(getAllTags(posts))];
}

/** returns a count of each unique tag - [[tagName, count], ...]
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getUniqueTagsWithCount(posts: CollectionEntry<"post">[]): [string, number][] {
	return [
		...getAllTags(posts).reduce(
			(acc, t) => acc.set(t, (acc.get(t) ?? 0) + 1),
			new Map<string, number>(),
		),
	].sort((a, b) => b[1] - a[1]);
}
