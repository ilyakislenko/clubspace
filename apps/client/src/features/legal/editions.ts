import type { ComponentType } from "react"

import type { SellerRequisites } from "../../shared/api/legal"

// What an edition's text may print from the server's configuration. seller is
// null when the API was unreachable (requisites render as «заполняется»).
export type EditionProps = {
  seller: SellerRequisites | null
  acceptGraceDays: number
}

// Edition version («YYYY-MM-DD», optionally with a suffix, the same string as
// PLATFORM_OFFER_VERSION / PLATFORM_DPA_VERSION) → its text. Published
// editions are never edited: a change is a new entry (docs/legal/README.md).
export type EditionRegistry = Record<string, ComponentType<EditionProps>>

// Newest first. Versions start with an ISO date, so they sort as strings.
export const editionVersions = (registry: EditionRegistry): string[] =>
  Object.keys(registry).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

// The text of a version, own keys only (a URL segment like «constructor»
// must not resolve to something inherited).
export const findEdition = (
  registry: EditionRegistry,
  version: string,
): ComponentType<EditionProps> | null =>
  Object.hasOwn(registry, version) ? registry[version] : null

// The edition in force: the one the server names when the registry has its
// text, else the newest text we have (also the fallback without the API).
export const currentEditionVersion = (
  registry: EditionRegistry,
  serverVersion: string | null,
): string =>
  serverVersion && findEdition(registry, serverVersion)
    ? serverVersion
    : editionVersions(registry)[0]

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

// «2026-11-01» → «1 ноября 2026 г.»; a suffixed version keeps the full string
// in brackets so two editions of one day stay distinguishable.
export const formatEditionDate = (version: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(version)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  if (!m || !month) return version
  const label = `${Number(m[3])} ${month} ${m[1]} г.`
  return version.length > 10 ? `${label} (${version})` : label
}

// «1 календарный день», «3 календарных дня», «14 календарных дней».
export const calendarDays = (n: number): string => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} календарный день`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} календарных дня`
  }
  return `${n} календарных дней`
}
