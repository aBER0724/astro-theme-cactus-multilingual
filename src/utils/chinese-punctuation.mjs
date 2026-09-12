const CJK = /[\u3400-\u9fff]/;
const ASCII_WORD = /[A-Za-z0-9_$]/;
const PROTECTED_TOKEN = "\u0000";

function protect(text) {
	const values = [];
	const patterns = [
		/`+[^`]*`+/g,
		/\]\((?:\\.|[^()\n])*\)/g,
		/https?:\/\/[^\s<>()]+/gi,
		/\bwww\.[^\s<>()]+/gi,
		/<[^>\n]+>/g,
	];
	let result = text;

	for (const pattern of patterns) {
		result = result.replace(pattern, (value) => {
			const index = values.push(value) - 1;
			return `${PROTECTED_TOKEN}${index}${PROTECTED_TOKEN}`;
		});
	}

	return { result, values };
}

function restore(text, values) {
	return text.replace(/\u0000(\d+)\u0000/g, (_, index) => values[Number(index)]);
}

function hasChineseText(text) {
	return CJK.test(text);
}

function isBetweenAsciiWords(text, index) {
	return ASCII_WORD.test(text[index - 1] ?? "") && ASCII_WORD.test(text[index + 1] ?? "");
}

function convertQuotes(text) {
	return text
		.replace(/"([^"\n]*[\u3400-\u9fff][^"\n]*)"/g, "“$1”")
		.replace(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g, "‘$1’");
}

function convertParentheses(text) {
	return text.replace(
		/(^|[^A-Za-z0-9_$])\(([^()\n]*[\u3400-\u9fff][^()\n]*)\)/g,
		"$1（$2）",
	);
}
function convertText(text, allowStandalonePunctuation = false) {
	if (!allowStandalonePunctuation && !hasChineseText(text)) return text;

	let result = text.replace(/\.\.\./g, "……");
	result = [...result]
		.map((char, index) => {
			if (char === ",") return "，";
			if (char === "!") return "！";
			if (char === "?") return "？";
			if (char === ";") return "；";
			if (char === ":" && !(/\d/.test(result[index - 1] ?? "") && /\d/.test(result[index + 1] ?? ""))) {
				return "：";
			}
			if (char === ".") return "。";
			return char;
		})
		.join("");

	return convertParentheses(convertQuotes(result));
}

/** Convert conservative English punctuation in Chinese prose. */
export function convertChinesePunctuation(text, allowStandalonePunctuation = false) {
	const { result, values } = protect(text);
	return restore(convertText(result, allowStandalonePunctuation), values);
}

/** Whether the text contains punctuation that would be converted. */
export function hasChinesePunctuationIssues(text) {
	return convertChinesePunctuation(text) !== text;
}
