import { i18nConfig } from "@/site.config";

// Per-locale label map, derived from i18nConfig.locales. Add or reorder a
// language in src/site.config.ts and the switcher + routing pick it up.
export const languages = Object.fromEntries(
	i18nConfig.locales.map((l) => [l.code, l.label]),
) as Record<UiLanguage, string>;

export type UiLanguage = (typeof i18nConfig.locales)[number]["code"];

// The default UI language renders on unprefixed routes (/, /about, /posts…) —
// the authoring language of the site. /ja and /en are their own versions.
// Configure it in src/site.config.ts → i18nConfig.locales (the `default` entry).
export const defaultUiLanguage: UiLanguage =
	i18nConfig.locales.find((l) => "default" in l && l.default)?.code ??
	i18nConfig.locales[0]!.code;

export const defaultLocaleCode = defaultUiLanguage;

/** Locale codes that are served under a URL prefix (every locale except the default). */
export const prefixedLocales: readonly UiLanguage[] = i18nConfig.locales
	.map((l) => l.code)
	.filter((code) => code !== defaultUiLanguage);

// Matches a leading /<code> prefix on the URL path. Built once from the
// configured prefixed locales, so adding a language needs no code change.
const pathLangRe = new RegExp(`^/(?:${prefixedLocales.join("|")})\\b`);

// Maps a URL path's locale prefix to the UI language it should render in.
// Unprefixed routes fall back to the default.
export function uiLanguageFromPath(pathname: string): UiLanguage {
	const match = pathname.match(pathLangRe);
	if (match) {
		return match[0].slice(1) as UiLanguage;
	}
	return defaultUiLanguage;
}

// Adds the language prefix to an internal, unprefixed path (e.g. "/about/").
// The default (authoring) locale passes through unchanged.
export function localizedPath(path: string, locale: UiLanguage): string {
	return locale === defaultUiLanguage ? path : `/${locale}${path}`;
}

// A section whose content IS always in Chinese regardless of UI language —
// the translated (non-post) pages under /ja and /en only exist for posts.
// Home/about/uses bodies stay as authored; we localize the chrome (menu,
// headings, meta) around them.

const ui = {
	en: {
		"nav.home": "Home",
		"nav.about": "About",
		"nav.uses": "Uses",
		"nav.blog": "Blog",
		"nav.notes": "Notes",
		"nav.tags": "Tags",
		"nav.main": "Main",
		"nav.footer": "Footer",
		"header.openMenu": "Open main menu",
		"home.title": "aBER",
		"home.greeting": "Hey there 👋",
		"home.intro":
			"Welcome to my little corner of the internet. I'm an information security undergrad preparing for Japanese master's entrance exams, and I write about development, school life, and whatever else catches my eye.",
		"home.pinnedPosts": "Pinned Posts",
		"home.posts": "Posts",
		"home.notes": "Notes",
		"404.title": "Oops! You found a missing page!",
		"404.heading": "404 | Oops something went wrong",
		"404.body": "Please use the navigation to find your way back",
		"posts.title": "Posts",
		"posts.description": "Read my collection of posts and the things that interest me",
		"posts.pinned": "Pinned Posts",
		"posts.in": "Posts in",
		"posts.rss": "RSS feed",
		"posts.tags": "Tags",
		"posts.viewAllTags": "View all",
		"posts.viewAllTagsSr": "blog tags",
		"posts.tagPostsSr": "View all posts with the tag",
		"posts.prev": "← Previous Page",
		"posts.next": "Next Page →",
		"notes.title": "Notes",
		"notes.description": "Read my collection of notes",
		"tags.title": "All Tags",
		"tags.description": "A list of all the topics I've written about in my posts",
		"tags.heading": "Tags",
		"tags.viewWithTag": "View posts with the tag:",
		"tags.postCount": "Post",
		"tags.postCountPlural": "Posts",
		"tags.breadcrumbs": "Breadcrumbs",
		"tags.prev": "← Previous Tags",
		"tags.next": "Next Tags →",
		"tags.metaDesc": "View all posts with the tag -",
		"tags.metaTitle": "Posts about",
		"about.title": "About",
		"about.description":
			"About aBER — a personal blog author preparing for Japanese master's entrance exams",
		"uses.title": "Uses",
		"uses.description":
			"My daily writing and development setup for coding, publishing, and keeping this blog tidy.",
		"pagination.previous": "Previous",
		"pagination.next": "Next",
		"footer.poweredBy":
			'Powered by <a class="hover:text-global-text hover:underline" href="https://astro.build" target="_blank" rel="noreferrer">Astro</a> and <a class="hover:text-global-text hover:underline" href="https://github.com/chrismwilliams/astro-theme-cactus" target="_blank" rel="noreferrer">Astro Cactus</a>',
		"post.draft": "(Draft)",
		"post.updated": "Updated:",
		"post.tagMore": "View more blogs with the tag",
		"mention.count": "Mention",
		"mention.countPlural": "Mentions",
		skipLink: "Skip to content",
		languageSwitcher: "Language versions",
		"toc.title": "Table of Contents",
		"toc.hide": "Hide table of contents",
		"toc.show": "Show table of contents",
		"toc.skip": "Skip to content",
		backToTop: "Back to top",
		"note.readAbout": "Read about my note posted on:",
		"home.socials": "Find me on",
		"theme.toggle": "Toggle dark theme",
		"webmention.title": "Webmentions for this post",
		"webmention.poweredBy": "Responses powered by",
	},
	zh: {
		"nav.home": "首页",
		"nav.about": "关于",
		"nav.uses": "设备",
		"nav.blog": "博客",
		"nav.notes": "杂记",
		"nav.tags": "标签",
		"nav.main": "主导航",
		"nav.footer": "页脚",
		"header.openMenu": "打开主菜单",
		"home.title": "aBER",
		"home.greeting": "你好 👋",
		"home.intro":
			"欢迎来到我的网络小角落。我是一名信息安全专业的本科生，正在备考日本硕士入学考试，平时写一些开发、校园生活以及各种吸引我注意力的话题。",
		"home.pinnedPosts": "置顶文章",
		"home.posts": "文章",
		"home.notes": "杂记",
		"404.title": "哎呀！你找到了一个不存在的页面！",
		"404.heading": "404 | 哎呀，出错了",
		"404.body": "请使用导航回到你想去的地方",
		"posts.title": "文章",
		"posts.description": "阅读我的文章合集，以及我感兴趣的事物",
		"posts.pinned": "置顶文章",
		"posts.in": "发布于",
		"posts.rss": "RSS 订阅",
		"posts.tags": "标签",
		"posts.viewAllTags": "查看全部",
		"posts.viewAllTagsSr": "博客标签",
		"posts.tagPostsSr": "查看带有该标签的所有文章",
		"posts.prev": "← 上一页",
		"posts.next": "下一页 →",
		"notes.title": "杂记",
		"notes.description": "阅读我的杂记合集",
		"tags.title": "全部标签",
		"tags.description": "我在文章中写过的话题列表",
		"tags.heading": "标签",
		"tags.viewWithTag": "查看带有该标签的文章：",
		"tags.postCount": "篇文章",
		"tags.postCountPlural": "篇文章",
		"tags.breadcrumbs": "面包屑导航",
		"tags.prev": "← 上一条标签",
		"tags.next": "下一条标签 →",
		"tags.metaDesc": "查看带有该标签的所有文章 -",
		"tags.metaTitle": "关于",
		"about.title": "关于",
		"about.description": "关于 aBER —— 一位准备日本硕士入学考试的个人博客作者",
		"uses.title": "设备",
		"uses.description": "我日常写作和开发的设备配置，用于写代码、发布内容以及维护这个博客。",
		"pagination.previous": "上一页",
		"pagination.next": "下一页",
		"footer.poweredBy":
			'由 <a class="hover:text-global-text hover:underline" href="https://astro.build" target="_blank" rel="noreferrer">Astro</a> 和 <a class="hover:text-global-text hover:underline" href="https://github.com/chrismwilliams/astro-theme-cactus" target="_blank" rel="noreferrer">Astro Cactus</a> 驱动',
		"post.draft": "（草稿）",
		"post.updated": "更新于：",
		"post.tagMore": "查看更多带有该标签的博客",
		"mention.count": "条提及",
		"mention.countPlural": "条提及",
		skipLink: "跳到主要内容",
		languageSwitcher: "语言切换",
		"toc.title": "目录",
		"toc.hide": "隐藏目录",
		"toc.show": "显示目录",
		"toc.skip": "跳到正文",
		backToTop: "回到顶部",
		"note.readAbout": "阅读我发布的杂记：",
		"home.socials": "我在这些地方：",
		"theme.toggle": "切换深色主题",
		"webmention.title": "这篇帖子的 Webmention",
		"webmention.poweredBy": "回应由",
	},
	ja: {
		"nav.home": "ホーム",
		"nav.about": "プロフィール",
		"nav.uses": "使用機材",
		"nav.blog": "ブログ",
		"nav.notes": "ノート",
		"nav.tags": "タグ",
		"nav.main": "メインナビ",
		"nav.footer": "フッター",
		"header.openMenu": "メインメニューを開く",
		"home.title": "aBER",
		"home.greeting": "こんにちは 👋",
		"home.intro":
			"私のネットの小さな居場所へようこそ。情報セキュリティ専攻の学部生で、日本の大学院入試に向けて勉強中。開発や学生生活、興味を引かれた様々なことを書いています。",
		"home.pinnedPosts": "固定記事",
		"home.posts": "記事",
		"home.notes": "ノート",
		"404.title": "おっと！存在しないページに迷い込みました！",
		"404.heading": "404 | おっと、何かがおかしいようです",
		"404.body": "ナビゲーションを使って戻ってください",
		"posts.title": "記事",
		"posts.description": "記事のまとめと、私が興味を持ったものについて読む",
		"posts.pinned": "固定記事",
		"posts.in": "投稿:",
		"posts.rss": "RSS フィード",
		"posts.tags": "タグ",
		"posts.viewAllTags": "すべて見る",
		"posts.viewAllTagsSr": "ブログタグ",
		"posts.tagPostsSr": "このタグのすべての記事を見る",
		"posts.prev": "← 前のページ",
		"posts.next": "次のページ →",
		"notes.title": "ノート",
		"notes.description": "ノートのまとめを読む",
		"tags.title": "すべてのタグ",
		"tags.description": "記事で書いたテーマの一覧",
		"tags.heading": "タグ",
		"tags.viewWithTag": "このタグの記事を見る：",
		"tags.postCount": "件",
		"tags.postCountPlural": "件",
		"tags.breadcrumbs": "パンくずナビ",
		"tags.prev": "← 前のタグ",
		"tags.next": "次のタグ →",
		"tags.metaDesc": "このタグのすべての記事を見る -",
		"tags.metaTitle": "について",
		"about.title": "プロフィール",
		"about.description": "aBERについて — 日本の大学院入試を準備する個人ブログの著者",
		"uses.title": "使用機材",
		"uses.description": "コーディング、公開、このブログの整理に使う日常の執筆・開発環境。",
		"pagination.previous": "前へ",
		"pagination.next": "次へ",
		"footer.poweredBy":
			'<a class="hover:text-global-text hover:underline" href="https://astro.build" target="_blank" rel="noreferrer">Astro</a> と <a class="hover:text-global-text hover:underline" href="https://github.com/chrismwilliams/astro-theme-cactus" target="_blank" rel="noreferrer">Astro Cactus</a> で作られています',
		"post.draft": "（下書き）",
		"post.updated": "更新：",
		"post.tagMore": "このタグのブログをもっと見る",
		"mention.count": "件のメンション",
		"mention.countPlural": "件のメンション",
		skipLink: "本文へスキップ",
		languageSwitcher: "言語切り替え",
		"toc.title": "目次",
		"toc.hide": "目次を隠す",
		"toc.show": "目次を表示",
		"toc.skip": "本文へスキップ",
		backToTop: "トップへ戻る",
		"note.readAbout": "投稿日: のノートを読む",
		"home.socials": "見つけてね：",
		"theme.toggle": "ダークテーマ切替",
		"webmention.title": "この記事への Webmention",
		"webmention.poweredBy": "返信は",
	},
} as const;

export type UiStrings = (typeof ui)[UiLanguage];

// Strings for a locale. Falls back to the default locale's strings when a
// configured language is missing a block in the `ui` object above (e.g. you
// added "fr" to i18nConfig but haven't written the strings yet).
export function getUiStrings(lang: UiLanguage): UiStrings {
	return ui[lang] ?? ui[defaultUiLanguage];
}
