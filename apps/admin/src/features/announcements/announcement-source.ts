// Federation announcements reach a club's staff list read-only, marked with
// where they came from (docs/design/2026-11-26-federation-hub-mvp.md §4.2).

type Sourced = {
  source?: { kind: "organization"; organizationId: string; name: string }
}

// «От федерации «…»», or null for the club's own announcement.
export const announcementSourceLine = (a: Sourced): string | null =>
  a.source?.kind === "organization" ? `От федерации «${a.source.name}»` : null

// The club's list (pinned first, newest created first, as the server sorts
// it) with the federations' items merged in by publication; never pinned.
export const mergeFederationItems = <
  T extends Sourced & { pinned: boolean; createdAt: string; publishedAt: string | null },
>(
  club: readonly T[],
  federation: readonly T[],
): T[] => {
  if (federation.length === 0) return [...club]
  const at = (a: T) => (a.source ? (a.publishedAt ?? a.createdAt) : a.createdAt)
  const pinned = club.filter((a) => a.pinned)
  const rest = [...club.filter((a) => !a.pinned), ...federation].sort((a, b) => at(b).localeCompare(at(a)))
  return [...pinned, ...rest]
}
