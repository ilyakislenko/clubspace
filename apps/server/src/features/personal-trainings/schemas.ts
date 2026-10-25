import { z } from 'zod'

import { displayName } from '../attendance/schemas'
import {
    displayStatus,
    type PersonalTrainingOptionLike,
    type PersonalTrainingStatus,
} from './personal-training-utils'

const PersonRefSchema = z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
})

export const PersonalTrainingOutputSchema = z.object({
    id: z.string().uuid(),
    status: z.enum([
        'PENDING_COACH',
        'PENDING_MEMBER',
        'CONFIRMED',
        'DECLINED',
        'CANCELLED',
    ]),
    // status plus the two states derived from the clock.
    displayStatus: z.enum([
        'PENDING_COACH',
        'PENDING_MEMBER',
        'CONFIRMED',
        'DECLINED',
        'CANCELLED',
        'COMPLETED',
        'EXPIRED',
    ]),
    member: PersonRefSchema,
    coach: PersonRefSchema,
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    // IANA zone the proposed wall-clock times were entered in.
    timezone: z.string(),
    options: z.array(
        z.object({
            id: z.string().uuid(),
            startAt: z.iso.datetime(),
            durationMin: z.number().int(),
            proposedBy: z.enum(['member', 'coach']),
        }),
    ),
    confirmedStartAt: z.iso.datetime().nullable(),
    confirmedDurationMin: z.number().int().nullable(),
    sessionId: z.string().uuid().nullable(),
    memberComment: z.string().nullable(),
    coachComment: z.string().nullable(),
    closeComment: z.string().nullable(),
    closedByRole: z.enum(['member', 'coach']).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type PersonalTrainingOutput = z.infer<
    typeof PersonalTrainingOutputSchema
>

type Person = {
    id: string
    firstname: string | null
    lastname: string | null
    email: string
}

export type PersonalTrainingRow = {
    id: string
    status: PersonalTrainingStatus
    memberId: string
    coachId: string
    member: Person
    coach: Person
    gym: { id: string; name: string; address: string } | null
    timezone: string
    options: Array<PersonalTrainingOptionLike>
    confirmedStartAt: Date | null
    confirmedDurationMin: number | null
    sessionId: string | null
    memberComment: string | null
    coachComment: string | null
    closeComment: string | null
    closedByRole: string | null
    createdAt: Date
    updatedAt: Date
}

const asRole = (v: string | null): 'member' | 'coach' | null =>
    v === 'member' || v === 'coach' ? v : null

export const serializePersonalTraining = (
    r: PersonalTrainingRow,
    now: Date,
): PersonalTrainingOutput => ({
    id: r.id,
    status: r.status,
    displayStatus: displayStatus(r, now),
    member: { userId: r.memberId, displayName: displayName(r.member) },
    coach: { userId: r.coachId, displayName: displayName(r.coach) },
    gym: r.gym
        ? { id: r.gym.id, name: r.gym.name, address: r.gym.address }
        : null,
    timezone: r.timezone,
    options: [...r.options]
        .sort(
            (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.startAt.getTime() - b.startAt.getTime(),
        )
        .map((o) => ({
            id: o.id,
            startAt: o.startAt.toISOString(),
            durationMin: o.durationMin,
            proposedBy: o.proposedBy === 'coach' ? 'coach' : 'member',
        })),
    confirmedStartAt: r.confirmedStartAt?.toISOString() ?? null,
    confirmedDurationMin: r.confirmedDurationMin,
    sessionId: r.sessionId,
    memberComment: r.memberComment,
    coachComment: r.coachComment,
    closeComment: r.closeComment,
    closedByRole: asRole(r.closedByRole),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
})
