import { z } from 'zod'

import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import { resolveSlotOccurrence } from '../attendance/attendance-utils'

export const DropInBookingOutputSchema = z.object({
    id: z.string().uuid(),
    slotId: z.string().uuid(),
    groupId: z.string().uuid(),
    groupName: z.string(),
    // slotId:yyyy-mm-dd — the same key the club schedule gives each occurrence.
    occurrenceId: z.string(),
    sessionDate: z.iso.date(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    durationMin: z.number().int(),
    // IANA zone the class wall-clock lives in (gym zone, else the club's).
    timezone: z.string(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    coachName: z.string(),
    // The class was cancelled or removed from the schedule after booking.
    cancelled: z.boolean(),
    createdAt: z.iso.datetime(),
})
export type DropInBookingOutput = z.infer<typeof DropInBookingOutputSchema>

export const serializeDropInBooking = (
    b: {
        id: string
        slotId: string
        groupId: string
        sessionDate: Date
        createdAt: Date
        slot: { durationMin: number }
        group: {
            name: string
            gym: { id: string; name: string; address: string } | null
            coach: {
                firstname: string | null
                lastname: string | null
                email: string
            }
        }
    },
    occ: ReturnType<typeof resolveSlotOccurrence>,
): DropInBookingOutput => {
    const sessionDate = b.sessionDate.toISOString().slice(0, 10)
    return {
        id: b.id,
        slotId: b.slotId,
        groupId: b.groupId,
        groupName: b.group.name,
        occurrenceId: `${b.slotId}:${sessionDate}`,
        sessionDate,
        startAt: occ.startAt.toISOString(),
        endAt: occ.endAt.toISOString(),
        durationMin: b.slot.durationMin,
        timezone: occ.timezone,
        gym: b.group.gym
            ? {
                  id: b.group.gym.id,
                  name: b.group.gym.name,
                  address: b.group.gym.address,
              }
            : null,
        coachName: fullNameWithoutEmail(b.group.coach),
        cancelled: !occ.scheduled || occ.cancelled,
        createdAt: b.createdAt.toISOString(),
    }
}
