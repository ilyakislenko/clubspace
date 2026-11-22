import type { ClubAboutInput } from "../../shared/api/club-about"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"

const L = FORM_LIMITS.clubAbout

export type ClubAboutDraft = {
  contacts: Array<{ label: string; phone: string }>
  links: Array<{ label: string; url: string }>
  rules: string
}

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
  if (draft.contacts.length > L.contacts.max) {
    return `Контактов не больше ${L.contacts.max}`
  }
  if (draft.links.length > L.links.max) {
    return `Ссылок не больше ${L.links.max}`
  }
  for (const c of draft.contacts) {
    if (!c.label.trim()) return "Укажите подпись контакта"
    if (c.label.trim().length > L.contactLabel.max) {
      return `Подпись контакта — не длиннее ${L.contactLabel.max} символов`
    }
    if (!isPhone(c.phone)) {
      return `Телефон «${c.phone.trim()}» не похож на номер — укажите номер с кодом страны, например +7 952 884-94-20`
    }
  }
  for (const l of draft.links) {
    if (!l.label.trim()) return "Укажите подпись ссылки"
    if (l.label.trim().length > L.linkLabel.max) {
      return `Подпись ссылки — не длиннее ${L.linkLabel.max} символов`
    }
    if (l.url.trim().length > L.linkUrl.max) {
      return `Ссылка — не длиннее ${L.linkUrl.max} символов`
    }
    if (!isHttpUrl(l.url.trim())) {
      return "Ссылка должна начинаться с http:// или https://"
    }
  }
  if (draft.rules.trim().length > L.rules.max) {
    return `Правила — не длиннее ${L.rules.max.toLocaleString("ru-RU")} символов`
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
