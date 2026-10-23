// Sync the badge definitions and icons from the Hockay app into
// `src/data/badges.json`, for the table on /guides/badges.
//
// Reads two things from apps/web:
//   - `src/lib/badges.ts`: BADGE_DEFINITIONS (name, tooltip, category, rarity,
//     colour). Parsed with acorn rather than evaluated; the object literal is
//     plain JS once you start at its opening brace.
//   - `src/components/badge-icons/`: one React component per badge. Each is a
//     bare <svg> with `className={className}` as its only expression, so the
//     markup is lifted out as text and its React attribute names are mapped
//     back to SVG ones. Anything outside that shape fails the run instead of
//     shipping a half-converted icon.
//
// The badge type (`first_bet`, ...) is the app's internal id and is not
// written out. The page shows names, never slugs.
//
// Usage: node scripts/sync-badges.mjs [path-to-hockay-repo]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExpressionAt } from "acorn";

const HOCKAY = process.argv[2] ?? join(process.env.HOME, "hockay");
const WEB = join(HOCKAY, "apps/web/src");
const OUT = fileURLToPath(new URL("../src/data/badges.json", import.meta.url));
const PAGE = fileURLToPath(
	new URL("../src/content/docs/guides/badges.mdx", import.meta.url),
);

const FIELDS = ["name", "description", "category", "rarity", "color"];

// React's names for the SVG attributes the icons use. `viewBox` is camelCase
// in SVG itself and passes through.
const ATTRIBUTES = {
	strokeLinecap: "stroke-linecap",
	strokeLinejoin: "stroke-linejoin",
	strokeWidth: "stroke-width",
};

const fail = (message) => {
	console.error(message);
	process.exit(1);
};

// ── Definitions ──

const source = readFileSync(join(WEB, "lib/badges.ts"), "utf8");
const start = source.indexOf(
	"{",
	source.indexOf("export const BADGE_DEFINITIONS"),
);
if (start === -1) fail("BADGE_DEFINITIONS not found in lib/badges.ts");

const literal = parseExpressionAt(source, start, { ecmaVersion: "latest" });
const keyOf = (property) => property.key.name ?? property.key.value;

const definitions = literal.properties.map((property) => {
	const type = keyOf(property);
	const def = Object.fromEntries(
		property.value.properties.map((field) => [keyOf(field), field.value.value]),
	);
	for (const field of FIELDS) {
		if (typeof def[field] !== "string") fail(`${type}: no string "${field}"`);
	}
	return { type, ...def };
});

// ── Icons ──

const iconDir = join(WEB, "components/badge-icons");

function iconFor(type) {
	const path = join(iconDir, `${type}.tsx`);
	if (!existsSync(path)) fail(`${type}: no icon at badge-icons/${type}.tsx`);

	const tsx = readFileSync(path, "utf8");
	const open = tsx.indexOf("<svg");
	const close = tsx.lastIndexOf("</svg>");
	if (open === -1 || close === -1) fail(`${type}: no <svg> in icon`);

	const svg = tsx
		.slice(open, close + "</svg>".length)
		.replace(/\s+className=\{className\}/, "")
		// The titles are component names ("FirstBet"). The badge name sits next
		// to the icon in the table, so the icon is decorative.
		.replace(/<title>[^<]*<\/title>/, "")
		.replace(/\s([a-z]+[A-Z][a-zA-Z]*)=/g, (match, name) => {
			if (name === "viewBox") return match;
			if (!ATTRIBUTES[name]) fail(`${type}: unmapped attribute ${name}`);
			return ` ${ATTRIBUTES[name]}=`;
		})
		.replace(/\s+/g, " ")
		.replace(/\s(\/?>)/g, "$1")
		.replace(/> </g, "><")
		.replace(/<svg /, '<svg aria-hidden="true" ');

	if (svg.includes("{")) fail(`${type}: JSX expression left in icon`);
	return svg;
}

const badges = definitions.map(({ type, ...def }) => ({
	...def,
	svg: iconFor(type),
}));

mkdirSync(fileURLToPath(new URL("../src/data/", import.meta.url)), {
	recursive: true,
});
writeFileSync(OUT, `${JSON.stringify(badges, null, "\t")}\n`);

// ── Report ──

// The page lists one section per category by hand, so a category the app
// adds would otherwise never be shown.
const page = readFileSync(PAGE, "utf8");
const counts = new Map();
for (const badge of badges) {
	counts.set(badge.category, (counts.get(badge.category) ?? 0) + 1);
}
const missing = [...counts.keys()].filter(
	(category) => !page.includes(`category="${category}"`),
);

console.log(
	`${badges.length} badges · ${[...counts].map(([c, n]) => `${c} ${n}`).join(", ")}`,
);
if (missing.length) {
	fail(
		`not on guides/badges.mdx: ${missing.join(", ")}. Add a section for each.`,
	);
}
