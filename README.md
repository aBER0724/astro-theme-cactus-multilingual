# Astro Cactus — Multilingual

A multilingual fork of [Astro Cactus](https://github.com/chrismwilliams/astro-cactus), the blog theme for [Astro](https://astro.build) — for authors who publish in one language and want the rest of the site (UI, posts, tags, pages) to follow automatically.

## Features (vs upstream Astro Cactus)

- **Trilingual out of the box** — `zh` (unprefixed default) + `en` / `ja` prefixed routes. All language & translation settings live in one `src/site.config.ts` → `i18nConfig`; the switcher, routing, schema validation and every list page derive from it — adding a language is a one-line change.
- **Local AI translation pipeline** — `scripts/translate.mjs` turns Simplified-Chinese posts into committed `content/translations/<lang>/` files at build prep time; no runtime AI service needed (see [AI Translation](#ai-translation)).
- **Diagrams in one place** — Mermaid, Graphviz and GitHub-embedded cards render inside Markdown posts.
- **Scripted social cards & OG images** — generate the default social card and per-post OG images locally with `node scripts/generate-social-card.mjs`.
- **Back-to-top + polished header/footer** — UX polish over the upstream theme.
- **Platform-agnostic deploy** — Vercel and Cloudflare Pages both auto-detect their canonical URL (`VERCEL_URL` / `CF_PAGES_URL`); custom domains work with zero config.

## Tech Stack

- Astro 7
- Tailwind CSS v4
- MD & MDX posts and notes
- [Satori](https://github.com/vercel/satori) for open graph PNG images
- Automatic RSS feeds, sitemap, robots.txt
- [Pagefind](https://pagefind.app/) static search
- Dark & light mode

## Commands

Replace pnpm with your choice of npm / yarn.

| Command           | Action                                                         |
| :---------------- | :------------------------------------------------------------- |
| `pnpm install`    | Installs dependencies                                          |
| `pnpm dev`        | Starts local dev server at `localhost:4321`                    |
| `pnpm build`      | Build your production site to `./dist/`                        |
| `pnpm postbuild`  | Pagefind script to build the static search of blog posts       |
| `pnpm preview`    | Preview your build locally, before deploying                   |
| `pnpm astro sync` | Generate types based on your config in `src/content.config.ts` |
| `pnpm translate:dry`   | Preview pending Japanese/English translations (no API calls)   |
| `pnpm translate`       | Translate changed Chinese posts into Japanese and English     |
| `pnpm translate:force` | Re-translate all Chinese posts, ignoring source hashes        |

## Adding Posts, Notes, and Tags

Content lives in the `content/` directory: `content/posts`, `content/notes`, and `content/tags`. The filename of a file becomes its slug/url. For a tag page to render, the filename in `content/tags` must match a tag used in a post's `tags` frontmatter.

### Post Frontmatter

| Property (\* required) | Description                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| title \*               | Used as the link text, the h1, and the page title. Max 60 chars.                                        |
| description \*         | Used as the SEO description property.                                                                   |
| publishDate \*         | Post publish date. Date format/locale can be changed in `src/site.config.ts`.                           |
| updatedDate            | Optional. Date the post was last updated.                                                               |
| tags                   | Optional. Any new tags generate pages at `/tags/[tag]`.                                                 |
| coverImage             | Optional. `{ src: "./path-to-image", alt: "...", }` adds a cover image to the top of the post.          |
| ogImage                | Optional. An OG image is auto-generated with Satori unless this property is provided.                   |
| draft                  | Optional (default `false`). `true` filters the post out of the production build.                        |
| lang                   | Optional source language; defaults to `zh-CN` and controls auto-translation.                         |

### Note Frontmatter

| Property (\* required) | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| title \*               | Used as the link text, page title, and h1. Max 60 chars. |
| description            | Optional. Used for the meta description.                 |
| publishDate \*         | ISO 8601 format with offsets allowed.                    |

### Tag Frontmatter

| Property    | Description                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------- |
| title       | Optional. Used as the h1 on the tag page. Max 60 chars.                                     |
| description | Optional. Used for the meta description and the first paragraph under the h1.               |

## Customization

- `src/site.config.ts` — site url, title, author, description, lang, date format, **and `i18nConfig`** (multilingual + translation settings, see below).
- `src/components/SocialList.astro` — social links (GitHub, X, Email, Telegram). Icons live in `src/icons/` and can be swapped.
- `public/icon.svg` — site logo, also the source for generated favicons & manifest icons.
- `public/social-card.png` — default `og:image` for pages without a custom one. Regenerate with `node scripts/generate-social-card.mjs` (reads title/author from `src/site.config.ts`).
- `src/pages/og-image/_ogMarkup.ts` — style of auto-generated OG images.

## Multilingual (i18n)

All language and translation settings are centralized in one place, `src/site.config.ts` → `i18nConfig` — the rest of the site derives from it:

```ts
export const i18nConfig = {
	locales: [
		{ code: "zh", label: "中文", default: true }, // default = unprefixed authoring language
		{ code: "en", label: "English" },
		{ code: "ja", label: "日本語" },
	],
	translateTo: ["ja", "en"], // default targets for scripts/translate.mjs
} as const;
```

- `locales` drives the language switcher, `/:locale/` routing, and the `UiLanguage` type. Reorder or extend it and the whole site follows — no regex or derived types to hand-edit.
- `default: true` marks the locale that renders on unprefixed routes (`/`, `/about/`, `/posts/`…) — the authoring language of the site.
- `translateTo` is the single source of truth for translation target languages: the local AI translation script, the `Locale` type, every `[locale]/` list page's `getStaticPaths`, and the `content/translations` schema validation all derive from it.

### Adding a language

1. Add an entry to `i18nConfig.locales`, e.g. `{ code: "fr", label: "Français" }` — the switcher and `/:locale/` routing pick it up immediately, no other edits.
2. Add a strings block under that key in `src/i18n/ui.ts` (optional — UI falls back to the default language until you do).
3. Either place translation files under `content/translations/fr/`, or add `"fr"` to `i18nConfig.translateTo` and run `pnpm translate` to generate them. Once `fr` is in `translateTo`, every `[locale]` page (posts / notes / tags / index / about / uses) and the translation schema follow automatically — there are no per-page locale lists to touch.

## AI Translation

Simplified-Chinese posts can be translated at preparation time into the languages listed in `i18nConfig.translateTo` (default: Japanese and English). Translation files are written to `content/translations/<lang>/` and committed to the repository, so the static site, sitemap, and Pagefind search do not need a runtime AI service.

Copy `.example.env` to `.env` and set the OpenAI-compatible API configuration. `.env` is gitignored and the API key must never be committed:

```env
AI_API_BASE=https://api.deepseek.com/v1
AI_API_KEY=your-key
AI_MODEL=deepseek-chat
AI_TARGET_LANGS=ja,en   # optional: overrides i18nConfig.translateTo for this run
```

Run `pnpm translate:dry` to inspect pending work, then `pnpm translate` to generate or update files. Target languages resolve CLI `--langs` first, then `AI_TARGET_LANGS`, then `i18nConfig.translateTo`. The script stores a `sourceHash` in each translation and skips unchanged posts; use `pnpm translate:force` only when a full retranslation is needed. Translation pages are available at `/<locale>/<slug>/`, with a language switcher shown when translations exist. Notes are not translated.

## Search

Pagefind only works on a built site (`pnpm build && pnpm postbuild`).

## Deploy

The site prerenders to static pages (`./dist`) — no adapter needed. See the [Astro deploy docs](https://docs.astro.build/en/guides/deploy/).

## Credits

Based on [Astro Cactus](https://github.com/chrismwilliams/astro-theme-cactus) (inspired by [Hexo Theme Cactus](https://github.com/probberechts/hexo-theme-cactus)).

## License

MIT
