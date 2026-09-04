import type { ImageFunction } from "astro:content";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { i18nConfig } from "@/site.config";

function removeDupsAndLowerCase(array: string[]) {
	return [...new Set(array.map((str) => str.toLowerCase()))];
}

const titleSchema = z.string().max(60);

const baseSchema = z.object({
	title: titleSchema,
});

function postFields(image: ImageFunction) {
	return baseSchema.extend({
		description: z.string(),
		coverImage: z
			.object({
				alt: z.string(),
				src: image(),
			})
			.optional(),
		draft: z.boolean().default(false),
		ogImage: z.string().optional(),
		tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
		publishDate: z
			.string()
			.or(z.date())
			.transform((val) => new Date(val)),
		updatedDate: z
			.string()
			.optional()
			.transform((str) => (str ? new Date(str) : undefined)),
		pinned: z.boolean().default(false),
	});
}

const post = defineCollection({
	loader: glob({ base: "./content/posts", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		postFields(image).extend({
			// Source language of the post. Only zh-CN (the default) gets auto-translated by scripts/translate.mjs
			lang: z.enum(["zh-CN", "zh", "ja", "en"]).default("zh-CN"),
		}),
});

const note = defineCollection({
	loader: glob({ base: "./content/notes", pattern: "**/*.{md,mdx}" }),
	schema: baseSchema.extend({
		description: z.string().optional(),
		publishDate: z.iso
			.datetime({ offset: true }) // Ensures ISO 8601 format with offsets allowed (e.g. "2024-01-01T00:00:00Z" and "2024-01-01T00:00:00+02:00")
			.transform((val) => new Date(val)),
	}),
});

const project = defineCollection({
	loader: glob({ base: "./content/projects", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		name: z.string().min(1).max(60).transform((name) => name.toLowerCase()),
		description: z.string().max(300),
		startDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
		repository: z.url(),
		techStack: z.array(z.string().min(1)).min(1),
		pinned: z.boolean().default(false),
	}),
});

const tag = defineCollection({
	loader: glob({ base: "./content/tags", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: titleSchema.optional(),
		description: z.string().optional(),
	}),
});

// Auto-generated translations (scripts/translate.mjs): each file lives at content/translations/<lang>/<source-slug>.md
// and points back to its source post via `source` (e.g. "posts/my-post").
// Pattern is intentionally one level deep so project translations
// (content/translations/<lang>/projects/…) are handled by their own collection.
const translation = defineCollection({
	loader: glob({ base: "./content/translations", pattern: "*/*.{md,mdx}" }),
	schema: ({ image }) =>
		postFields(image).extend({
			// Target languages written by scripts/translate.mjs, from site.config.ts
			lang: z.enum(i18nConfig.translateTo),
			source: z.string(),
			sourceHash: z.string().optional(),
		}),
});

// Localized project metadata (scripts/translate.mjs): each file lives at
// content/translations/<lang>/projects/<project-slug>.md and carries the
// translated description; everything else (name, repo, tech stack, dates)
// stays shared in the project entry itself.
const projectTranslation = defineCollection({
	loader: glob({ base: "./content/translations", pattern: "*/projects/*.{md,mdx}" }),
	schema: z.object({
		description: z.string().max(300),
		lang: z.enum(i18nConfig.translateTo),
		source: z.string().optional(),
		sourceHash: z.string().optional(),
	}),
});

export const collections = { post, note, project, tag, translation, projectTranslation };
