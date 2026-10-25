import type { ClubAboutInput } from "../../shared/api/club-about"

export type ClubAboutDraft = {
  contacts: Array<{ label: string; phone: string }>
  links: Array<{ label: string; url: string }>
  rules: string
}

export const MAX_ITEMS = 10

// Mirrors the server's normalizePhone: a leading «+» with 10–15 digits, or a
// Russian number of 11 digits starting with 7/8. «+8 9…» / «+8 3…» (11 digits,
// a Russian number with a stray plus) and anything but digits, spaces,
// brackets, dots and dashes (extensions: «доб.», «x12», «#», «,», «;») are
// refused.
const isPhone = (raw: string) => {
  const trimmed = raw.trim()
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 15) return false
  if (trimmed.startsWith("+")) {
    return !(digits.length === 11 && /^8[39]/.test(digits))
  }
  return digits.length === 11 && (digits[0] === "7" || digits[0] === "8")
}

// Control characters (tabs, NUL, DEL…) can make a URL parse differently in
// different places; a typed link never needs them.
const hasControlChars = (value: string) =>
  Array.from(value).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)

const isHttpUrl = (value: string) => {
  if (hasControlChars(value)) return false
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

// First problem found, in Russian for the admin; null when the draft can be saved.
export const validateClubAboutDraft = (draft: ClubAboutDraft): string | null => {
  if (draft.contacts.length > MAX_ITEMS) {
    return `Контактов не больше ${MAX_ITEMS}`
  }
  if (draft.links.length > MAX_ITEMS) {
    return `Ссылок не больше ${MAX_ITEMS}`
  }
  for (const c of draft.contacts) {
    if (!c.label.trim()) return "Укажите подпись контакта"
    if (c.label.trim().length > 120) return "Подпись контакта слишком длинная"
    if (!isPhone(c.phone)) {
      return `Телефон «${c.phone.trim()}» не похож на номер — укажите номер с кодом страны, например +7 952 884-94-20`
    }
  }
  for (const l of draft.links) {
    if (!l.label.trim()) return "Укажите подпись ссылки"
    if (l.label.trim().length > 60) return "Подпись ссылки слишком длинная"
    if (l.url.trim().length > 500) return "Ссылка слишком длинная"
    if (!isHttpUrl(l.url.trim())) {
      return "Ссылка должна начинаться с http:// или https://"
    }
  }
  if (draft.rules.trim().length > 10000) {
    return "Правила не длиннее 10000 символов"
  }
  return null
}

export const draftToInput = (draft: ClubAboutDraft): ClubAboutInput => ({
  contacts: draft.contacts.map((c) => ({
    label: c.label.trim(),
    phone: c.phone.trim(),
  })),
  links: draft.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
  rules: draft.rules.trim() ? draft.rules.trim() : null,
})

// Moves item `index` by `delta` (-1 up / +1 down); out-of-range is a no-op.
export const moveItem = <T>(items: T[], index: number, delta: -1 | 1): T[] => {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const next = items.slice()
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
