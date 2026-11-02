import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import ts from "typescript"

// Every screen of a club speaks the club's words: «тренировка / тренер» in
// the academy, «занятие / педагог» in a dance studio (see useVocabulary and
// libs/ui-kit/brand/vocabulary.ts). A literal one of these words in a UI
// string is one kind of club reading the other's words, so this scans every
// string and JSX text of the admin — comments are not strings and never match.

const SRC = join(__dirname, "..", "..")
const WORDS = /тренир|тренер|заняти/i

// Wording that is deliberately not the club's: a whole file (`true`) or the
// listed strings of it. An abonement counts «занятия» in every club, like
// «Осталось N занятий» in the app; outside a club there are no club words.
const ALLOWED: Record<string, true | readonly string[]> = {
  // Platform console and the club picker: about clubs in general.
  "app/(dashboard)/platform/page.tsx": true,
  "app/(dashboard)/workspaces/page.tsx": true,
  // Abonements and their plans.
  "app/(dashboard)/workspace/[workspaceId]/subscriptions/page.tsx": true,
  "app/(dashboard)/workspace/[workspaceId]/subscriptions/plans/[planId]/page.tsx": true,
  "features/subscriptions/MemberSubscriptionPanel.tsx": true,
  "features/subscriptions/subscription-display.ts": true,
  "app/(dashboard)/workspace/[workspaceId]/page.tsx": ["заканчиваются занятия / доступ"],
  "features/settings/app-sections.ts": [
    "Остаток занятий и статус абонемента.",
    "другой группы. Занятие списывается с абонемента, только когда гостя отметят на",
  ],
  // What a late cancel or a no-show takes from the abonement is an «занятие»,
  // as the app says it («При отмене спишется занятие»).
  "app/(dashboard)/workspace/[workspaceId]/settings/page.tsx": [
    "»: когда открывается запись, до какого момента можно отменить без последствий и списывать ли занятие с абонемента. Окно записи и срок отмены можно переопределить в карточке группы.",
    "Списывать занятие при поздней отмене",
    "Отмена позже срока бесплатной отмены забирает одно занятие из абонемента.",
    "Списывать занятие при неявке",
    "Записался, но не пришёл и не отменил — занятие списывается с абонемента.",
  ],
  // The import file's column is «осталось занятий» whatever the club.
  "features/club-import/ClubImportWizard.tsx": true,
  // A placeholder in the club's own voice, before it picks its words.
  "features/public-profile/PublicProfileSection.tsx": [
    "Чем занимаетесь, для кого занятия, чем клуб отличается",
  ],
}

const allowed = (file: string, text: string): boolean => {
  const rule = ALLOWED[file]
  return rule === true || (rule?.includes(text) ?? false)
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name) ? [path] : []
  })

// The strings, template pieces and JSX text of one file that name a class or
// a coach in one kind of club's words.
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
      found.push(node.text.trim().replace(/\s+/g, " "))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe("club vocabulary guard", () => {
  it("finds no hard-coded «тренировка/тренер/занятие» in the admin's UI strings", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .flatMap((file) =>
        offendingTexts(file, readFileSync(join(SRC, file), "utf8"))
          .filter((text) => !allowed(file, text))
          .map((text) => `${file}: «${text}»`),
      )
    expect(offenders).toEqual([])
  })

  it("catches a string, a template and JSX text, but not a comment", () => {
    const code = [
      "// тренер в комментарии не считается",
      'const a = "Новое занятие"',
      "const b = `Тренер: ${a}`",
      "export const C = () => <p>Отметить на тренировке</p>",
    ].join("\n")
    expect(offendingTexts("probe.tsx", code)).toEqual([
      "Новое занятие",
      "Тренер:",
      "Отметить на тренировке",
    ])
  })
})
