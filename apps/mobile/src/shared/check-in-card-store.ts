import type { CheckInCard } from "./api/check-in-card"

// The member's QR card, kept on the phone so «Моя карта» opens at the door
// with no connection. It lives in the resource cache (one JSON file per key,
// per profile, wiped on sign-out) under a key naming the person: the card is
// per person, not per club, and a child's profile has its own.
export const checkInCardKey = (userId: string): string =>
  `check-in-card:${userId}`

// "CS1.<userId>.<mac>" (docs/design/2026-11-26-door-checkin-and-birthdays.md §1).
const CARD_RE = /^CS1\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{16}$/

/** The person a card string names, or null when it isn't a ClubSpace card. */
export const cardUserId = (card: string): string | null =>
  CARD_RE.exec(card)?.[1] ?? null

/**
 * The card to show this viewer: only a well-formed card of their own with its
 * picture. Guards a snapshot left by an older build or another person.
 */
export const cardForViewer = (
  card: CheckInCard | null,
  userId: string | null,
): CheckInCard | null =>
  card &&
  userId !== null &&
  typeof card.qrPngDataUrl === "string" &&
  card.qrPngDataUrl.startsWith("data:image/png") &&
  cardUserId(card.card) === userId
    ? card
    : null

export type CheckInCardView = "card" | "loading" | "unavailable"

/**
 * What «Моя карта» shows: the card (cached or fresh), a spinner while the
 * first read runs, else «Карта появится, когда будет интернет» — no cache and
 * the read failed.
 */
export const checkInCardView = (s: {
  card: CheckInCard | null
  loading: boolean
}): CheckInCardView => (s.card ? "card" : s.loading ? "loading" : "unavailable")
