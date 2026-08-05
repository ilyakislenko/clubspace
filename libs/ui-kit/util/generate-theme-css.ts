/**
 * Generates `libs/ui-kit/util/globals.css` from the canonical token data in
 * `themes.ts`. The web consumes themes via `[data-theme="<key>"]` selectors
 * (+ `.dark` for the dark variant), wired to Tailwind's `hsl(var(--token))`.
 *
 * Run:  nx theme:generate @clubspace/ui-kit   (or: tsx libs/ui-kit/util/generate-theme-css.ts)
 *
 * Do NOT hand-edit globals.css — edit themes.ts and regenerate. CI drift-gates it.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  DEFAULT_THEME_KEY,
  THEME_KEYS,
  THEMES,
  type TokenSet,
} from "./themes"

const RADIUS = "0.625rem"

const toKebab = (key: string): string =>
  key
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .toLowerCase()

const vars = (tokens: TokenSet, indent: string, extra?: string): string => {
  const lines = Object.entries(tokens).map(
    ([k, v]) => `${indent}--${toKebab(k)}: ${v};`,
  )
  if (extra) lines.unshift(`${indent}${extra}`)
  return lines.join("\n")
}

const block = (selector: string, tokens: TokenSet, extra?: string): string =>
  `${selector} {\n${vars(tokens, "  ", extra)}\n}`

const buildCss = (): string => {
  const blocks: string[] = []

  // Defaults (no data-theme yet / SSR / no-JS): the default theme.
  blocks.push(block(":root", THEMES[DEFAULT_THEME_KEY].light, `--radius: ${RADIUS};`))
  blocks.push(block(".dark", THEMES[DEFAULT_THEME_KEY].dark))

  // One pair per theme. `[data-theme].dark` outranks the bare `.dark` fallback.
  for (const key of THEME_KEYS) {
    blocks.push(block(`[data-theme="${key}"]`, THEMES[key].light))
    blocks.push(block(`[data-theme="${key}"].dark`, THEMES[key].dark))
  }

  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Theme tokens — GENERATED FILE, do not edit by hand.
 * Source of truth: libs/ui-kit/util/themes.ts
 * Regenerate: nx theme:generate @clubspace/ui-kit
 */

/* THEME-TOKENS:START */
${blocks.join("\n\n")}
/* THEME-TOKENS:END */

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`
}

const out = join(__dirname, "globals.css")
writeFileSync(out, buildCss(), "utf8")
// eslint-disable-next-line no-console
console.log(`Wrote ${out} (${THEME_KEYS.length} themes × light/dark)`)
