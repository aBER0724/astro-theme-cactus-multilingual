// About page content, one locale per language. Rendering lives in
// src/pages/about.astro and follows the current UI language.
// Keep the keys identical across en / zh / ja so nothing can silently 404.
// This is placeholder content — replace it with your own text.

export type AboutEntry = {
	text: string;
	href?: string;
};

export type AboutGroup = {
	title: string;
	entries: AboutEntry[];
};

export type AboutBlock = {
	heading: string;
	groups: AboutGroup[];
};

export type AboutLocale = {
	intro: string;
	identity: string;
	currently: {
		heading: string;
		entries: string[];
	};
	blocks: AboutBlock[];
	site: {
		heading: string;
		parts: AboutEntry[];
	};
};

const astro = "https://github.com/withastro/astro";
const cactus = "https://github.com/chrismwilliams/astro-cactus";
const vercel = "https://vercel.com";

export const aboutData: Record<"en" | "zh" | "ja", AboutLocale> = {
	en: {
		intro: "Replace this with your own introduction.",
		identity: "Template placeholder ・ edit src/data/about.ts",
		currently: {
			heading: "Currently",
			entries: [
				"Editing src/data/about.ts is all it takes.",
				"Keep the same keys across en / zh / ja so nothing 404s.",
			],
		},
		blocks: [
			{
				heading: "Example",
				groups: [
					{
						title: "A group",
						entries: [{ text: "An entry without a link" }, { text: "An entry with a link", href: astro }],
					},
				],
			},
		],
		site: {
			heading: "About this site",
			parts: [
				{ text: "Built with " },
				{ text: "Astro", href: astro },
				{ text: " and customized from " },
				{ text: "Astro Cactus", href: cactus },
				{ text: ". Deployed on " },
				{ text: "Vercel", href: vercel },
				{ text: "." },
			],
		},
	},
	zh: {
		intro: "在这里替换成你自己的简介。",
		identity: "模板占位 ・ 编辑 src/data/about.ts",
		currently: {
			heading: "近况",
			entries: [
				"只需要编辑 src/data/about.ts 这一个文件。",
				"保持 zh / en / ja 各语言的键一致，避免 404。",
			],
		},
		blocks: [
			{
				heading: "示例",
				groups: [
					{
						title: "一个分组",
						entries: [{ text: "没有链接的条目" }, { text: "带链接的条目", href: astro }],
					},
				],
			},
		],
		site: {
			heading: "关于本站",
			parts: [
				{ text: "本站由 " },
				{ text: "Astro", href: astro },
				{ text: " 构建，并在 " },
				{ text: "Astro Cactus", href: cactus },
				{ text: " 基础上定制。部署在 " },
				{ text: "Vercel", href: vercel },
				{ text: " 上。" },
			],
		},
	},
	ja: {
		intro: "ここをあなた自身の自己紹介に置き換えてください。",
		identity: "テンプレートのプレースホルダー ・ src/data/about.ts を編集",
		currently: {
			heading: "近況",
			entries: [
				"src/data/about.ts を編集するだけでOKです。",
				"ja / en / zh でキーが同一になるようにしてください。",
			],
		},
		blocks: [
			{
				heading: "例",
				groups: [
					{
						title: "グループ",
						entries: [{ text: "リンクのない項目" }, { text: "リンクのある項目", href: astro }],
					},
				],
			},
		],
		site: {
			heading: "このサイトについて",
			parts: [
				{ text: "このサイトは " },
				{ text: "Astro", href: astro },
				{ text: " をベースに " },
				{ text: "Astro Cactus", href: cactus },
				{ text: " をカスタマイズして作成。デプロイ先は " },
				{ text: "Vercel", href: vercel },
				{ text: " です。" },
			],
		},
	},
};