import type { ScheduleSession } from "../../../shared/api/schedule"
import { coachShortName } from "./calendar-format"

// «Замена: И. Фамилия» for an approved substitute, «Запрос на замену» while
// pending, null without one.
export const substitutionLabel = (session: ScheduleSession): string | null => {
  const sub = session.substitution
  if (!sub) return null
  return sub.status === "APPROVED"
    ? `Замена: ${coachShortName(sub.substitute)}`
    : "Запрос на замену"
}
