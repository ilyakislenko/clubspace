// Guardian (parent) display helpers for child profiles. Rows are the
// `guardians[]` entries the server attaches to the members list, the member card
// and the at-risk call list.

import type { GuardianRelation, MemberGuardian } from "../api/members"

export const GUARDIAN_RELATION_LABELS: Record<GuardianRelation, string> = {
  PARENT: "Родитель",
  GUARDIAN: "Опекун",
  OTHER: "Другое",
}

// Line prefix for a guardian's contacts: "Другое" reads oddly before a name,
// so it becomes "Контакт".
export const GUARDIAN_LINE_PREFIX: Record<GuardianRelation, string> = {
  PARENT: "Родитель",
  GUARDIAN: "Опекун",
  OTHER: "Контакт",
}

export const guardianName = (g: MemberGuardian): string =>
  [g.firstname, g.lastname].filter(Boolean).join(" ").trim()

// Case-insensitive match of an already-lowercased query against any guardian's
// name, e-mail or phone.
export const guardiansMatchQuery = (
  guardians: readonly MemberGuardian[],
  query: string,
): boolean =>
  guardians.some(
    (g) =>
      guardianName(g).toLowerCase().includes(query) ||
      (g.email ?? "").toLowerCase().includes(query) ||
      (g.phone ?? "").includes(query),
  )
