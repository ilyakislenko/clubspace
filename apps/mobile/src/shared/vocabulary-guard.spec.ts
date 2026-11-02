import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import ts from "typescript"

// Every screen inside a club speaks the club's words: «тренировка / тренер» in
// the academy, «занятие / педагог» in a dance studio (see useVocabulary and
// libs/ui-kit/brand/vocabulary.ts). A literal «тренировка» or «тренер» in a UI
// string is a dance studio reading the academy's words, so this scans every
// string and JSX text of the app — comments are not strings and never match.

const SRC = join(__dirname, "..")
// «Ковёр» is the grappling academy's mat — a yoga or dance studio has none.
// The look-behind keeps «кратковременный» from matching.
const WORDS = /тренир|тренер|(?<![а-яё])ков[её]?р/i

// Files whose wording is deliberately not the club's:
const ALLOWED: Record<string, true> = {
  // The 152-ФЗ consent text is a legal document, worded once for every club.
  "features/consent/ConsentScreen.tsx": true,
  // Build-time brand presets of a branded app, shown before sign-in.
  "shared/brand.ts": true,
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })

// The strings, template pieces and JSX text of one file whose text names a
// class or a coach the academy's way.
const offendingTexts = (fileName: string, code: string): string[] => {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      WORDS.test(node.text)
    ) {
      found.push(node.text.trim())
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe("club vocabulary guard", () => {
  it("finds no hard-coded «тренировка/тренер» in the app's UI strings", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED[file])
      .flatMap((file) =>
        offendingTexts(file, readFileSync(join(SRC, file), "utf8")).map(
          (text) => `${file}: «${text}»`,
        ),
      )
    expect(offenders).toEqual([])
  })

  it("catches a string, a template and JSX text, but not a comment", () => {
    const code = [
      "// тренер в комментарии не считается",
      'const a = "Ближайшая тренировка"',
      "const b = `Тренер: ${a}`",
      "export const C = () => <Text>Отметиться на тренировке</Text>",
      'const d = "Открытый ковёр в субботу"',
      'const e = "кратковременным ссылкам"',
    ].join("\n")
    expect(offendingTexts("probe.tsx", code)).toEqual([
      "Ближайшая тренировка",
      "Тренер:",
      "Отметиться на тренировке",
      "Открытый ковёр в субботу",
    ])
  })
})
