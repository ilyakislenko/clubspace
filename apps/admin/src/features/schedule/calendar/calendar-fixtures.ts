// Test fixtures of the schedule calendar specs (not shipped: imported by specs only).
import type { ScheduleEvent, ScheduleSession } from "../../../shared/api/schedule"

const TZ = "Asia/Tomsk"

// 2026-11-04 19:00 Tomsk = 12:00Z.
export const sessionAt = (
  ymd: string,
  hhmm: string,
  patch: Partial<ScheduleSession> & { groupId?: string; gymId?: string; coachId?: string; directionColor?: string } = {},
): ScheduleSession => {
  const { groupId = "g1", gymId = "gym1", coachId = "c1", directionColor = "#2563eb", ...rest } = patch
  const [h, m] = hhmm.split(":").map(Number)
  const [y, mo, d] = ymd.split("-").map(Number)
  const start = new Date(Date.UTC(y, mo - 1, d, h - 7, m))
  const durationMin = rest.durationMin ?? 60
  return {
    occurrenceId: `slot-${groupId}:${ymd}`,
    slotId: `slot-${groupId}`,
    groupId,
    group: {
      id: groupId,
      name: `Группа ${groupId}`,
      gym: { id: gymId, name: `Зал ${gymId}`, address: "—" },
      direction: { id: "d1", name: "БЖЖ", color: directionColor, icon: null },
      coach: { id: coachId, email: null, firstname: "Роман", lastname: "Савельев" },
    },
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMin * 60_000).toISOString(),
    durationMin,
    dayOfWeek: 3,
    timezone: TZ,
    cancelled: false,
    cancellationReason: null,
    recurring: true,
    rescheduledFrom: null,
    rescheduledTo: null,
    bookedGuests: 0,
    booking: null,
    substitution: null,
    ...rest,
  }
}

export const eventAt = (startIso: string, endIso: string, patch: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: "e1",
  workspaceId: "w1",
  title: "Семинар",
  description: null,
  link: null,
  startAt: startIso,
  endAt: endIso,
  timezone: TZ,
  gym: { id: "gym1", name: "Зал gym1", address: "—" },
  direction: null,
  coach: null,
  createdById: "u1",
  createdAt: startIso,
  updatedAt: startIso,
  ...patch,
})
