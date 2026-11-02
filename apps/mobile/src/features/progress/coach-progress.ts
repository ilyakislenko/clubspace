import type { AttendanceOverview } from "../../shared/api/attendance"
import type { RankReadinessEntry } from "../../shared/api/rank-readiness"
import { pluralRu } from "../../shared/format-ru"

/**
 * The Progress tab's own blocks (attendance hero, milestones, rank, tenure) are
 * a student's. Staff see them only when they train themselves — a head coach
 * with no check-ins and no rank got «0 тренировок» and «Ранг пока не
 * присвоен — его назначает тренер».
 */
export const showsOwnProgress = (p: {
  staff: boolean
  totalCheckIns: number
  ranks: number
}): boolean => !p.staff || p.totalCheckIns > 0 || p.ranks > 0

/** «Мария Иванова»; the email when the member has no name. */
export const memberName = (e: {
  firstname: string | null
  lastname: string | null
  email: string | null
}): string =>
  [e.firstname, e.lastname].filter(Boolean).join(" ").trim() ||
  e.email ||
  "Без имени"

export type ReadinessDigest = {
  /** Who to show, those not yet put on a grading first (the coach's move). */
  shown: RankReadinessEntry[]
  /** Ready members left out of `shown`. */
  more: number
  ready: number
  /** Ready but not yet on any grading's list. */
  unlisted: number
  /** Not ready yet: still short of the visits or weeks. */
  soon: number
}

export const readinessDigest = (
  entries: readonly RankReadinessEntry[],
  limit: number,
): ReadinessDigest => {
  const ready = entries.filter((e) => e.ready)
  const unlisted = ready.filter((e) => !e.pendingGrading)
  const ordered = [...unlisted, ...ready.filter((e) => e.pendingGrading)]
  return {
    shown: ordered.slice(0, limit),
    more: Math.max(0, ordered.length - limit),
    ready: ready.length,
    unlisted: unlisted.length,
    soon: entries.length - ready.length,
  }
}

/** «12 тренировок · 148 отметок · 37 учеников» over the overview's window. */
export const overviewLine = (o: AttendanceOverview): string =>
  [
    `${o.sessionsHeld} ${pluralRu(o.sessionsHeld, "тренировка", "тренировки", "тренировок")}`,
    `${o.totalCheckIns} ${pluralRu(o.totalCheckIns, "отметка", "отметки", "отметок")}`,
    `${o.distinctAttendees} ${pluralRu(o.distinctAttendees, "ученик", "ученика", "учеников")}`,
  ].join(" · ")
