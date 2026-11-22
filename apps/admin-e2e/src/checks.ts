// What counts as a broken page, as data. Everything here is pure so
// checks.e2e.ts can pin it without a browser.

// Rendering leaks: a value that never arrived, or an object/number formatted
// as text. Word boundaries keep «NaN» inside a longer word from matching.
const BAD_TEXT = /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/g

// Each match with a little context, for the failure message.
export const findBadText = (text: string): string[] =>
  [...text.matchAll(BAD_TEXT)].map((m) => {
    const at = m.index ?? 0
    return `«${text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, ' ').trim()}»`
  })

// The app's error boundaries (app/error.tsx, app/global-error.tsx) and Next's
// default not-found page.
export const ERROR_SCREEN_TEXTS = ['Что-то пошло не так', 'This page could not be found'] as const

// What a loading state looks like in this admin: ui-kit Skeleton
// (animate-pulse), lucide spinners (animate-spin), aria-busy regions, and the
// «Загрузка…» family of placeholder texts (matched against a whole text node
// outside the sidebar). Not «Загрузка расписания» — that is the occupancy
// report's name — nor «Загрузка видео», the upload sheet's title.
export const LOADER_SELECTOR = '.animate-pulse, .animate-spin, [aria-busy="true"]'
export const LOADER_TEXT = /^(Загрузка|Загружаем[^.…]{0,30}|Проверяем (сессию|доступ)|Переходим)(…|\.\.\.)?$/

// The notice a gated section renders instead of its page
// (shared/workspace/access-gate.tsx).
export const ACCESS_DENIED_TEXT = /Раздел доступен|Нет доступа/

// Console errors that are not defects. Every entry needs a reason; keep this
// list short — an entry hides that message on every page for every role.
export const CONSOLE_ALLOWLIST: readonly { pattern: RegExp; reason: string }[] = []

export type HttpContext = 'page' | 'blocked'

// App defects that are reported and awaiting a fix. Each entry silences one
// response shape; delete it in the PR that fixes the defect.
export const KNOWN_DEFECTS: readonly { status: number; url: RegExp; reason: string }[] = []

// 4xx responses that are expected. `blocked`: a route the role must not open —
// a 403 there is the server holding the line, not a defect.
export const isExpected4xx = (status: number, context: HttpContext, url: string): boolean =>
  (context === 'blocked' && status === 403) ||
  KNOWN_DEFECTS.some((defect) => defect.status === status && defect.url.test(new URL(url).pathname))

export const isAllowedConsoleError = (text: string): boolean =>
  CONSOLE_ALLOWLIST.some((entry) => entry.pattern.test(text))
