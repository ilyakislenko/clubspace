import { z } from 'zod'

import {
    type OpenRequestRow,
    REQUEST_KINDS,
    type RequestMemberRow,
} from '../../domains/requests/open-requests'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { displayName } from '../attendance/schemas'
import { MemberGuardianSchema, serializeMemberGuardians } from '../dependents/schemas'
import { requestUntilYmd } from '../subscription-freeze-requests/freeze-request-utils'

export const RequestKindSchema = z.enum(REQUEST_KINDS)

export const RequestCountsSchema = z.object({
    join: z.number().int(),
    freeze: z.number().int(),
    personal: z.number().int(),
    video: z.number().int(),
    total: z.number().int(),
})

// One open request. Flat with one nullable detail per kind (no union in a
// DTO); exactly the detail of `kind` is set. No kind carries money.
export const OpenRequestSchema = z.object({
    // `<kind>:<uuid>` (join: the membership id); the deep-link key.
    id: z.string(),
    kind: RequestKindSchema,
    // What the decision endpoint takes: the applicant's userId for `join`,
    // else the request's id.
    requestId: z.string().uuid(),
    // Waiting since: when the member asked.
    createdAt: z.iso.datetime(),
    member: z.object({
        userId: z.string().uuid(),
        name: z.string(),
        email: z.string().nullable(),
        // A child profile without a login; its guardians are the contact.
        isDependent: z.boolean(),
        guardians: z.array(MemberGuardianSchema),
    }),
    join: z
        .object({
            // 'user' for a student; a staff role reaches club admins only.
            roleName: z.string(),
        })
        .nullable(),
    freeze: z
        .object({
            // Club-local days, both inclusive.
            fromDate: z.iso.date(),
            untilDate: z.iso.date(),
            days: z.number().int(),
            reason: z.string(),
            planName: z.string(),
            subscriptionId: z.string().uuid(),
            // The approve form's bound; null = open-ended abonement.
            subscriptionEndDate: z.iso.datetime().nullable(),
        })
        .nullable(),
    personal: z
        .object({
            coach: z.object({ userId: z.string().uuid(), name: z.string() }),
            gymName: z.string().nullable(),
            // IANA zone the member's times were entered in.
            timezone: z.string(),
            memberComment: z.string().nullable(),
            // The member's times still ahead, earliest first.
            options: z.array(
                z.object({
                    id: z.string().uuid(),
                    startAt: z.iso.datetime(),
                    durationMin: z.number().int(),
                }),
            ),
        })
        .nullable(),
    video: z
        .object({
            title: z.string(),
            message: z.string().nullable(),
            clipStatus: z.enum(['processing', 'ready']),
            durationSec: z.number().int().nullable(),
            commentCount: z.number().int(),
        })
        .nullable(),
})
export type OpenRequestOutput = z.infer<typeof OpenRequestSchema>

const serializeMember = (u: RequestMemberRow): OpenRequestOutput['member'] => ({
    userId: u.id,
    name: displayName(u),
    email: u.email,
    isDependent: u.email === null,
    guardians: serializeMemberGuardians(u.dependentOf),
})

const NO_DETAILS = { join: null, freeze: null, personal: null, video: null }

export const serializeOpenRequest = (r: OpenRequestRow): OpenRequestOutput => {
    const base = {
        id: `${r.kind}:${r.row.id}`,
        kind: r.kind,
        createdAt: r.row.createdAt.toISOString(),
        ...NO_DETAILS,
    }
    switch (r.kind) {
        case 'join':
            return {
                ...base,
                requestId: r.row.userId,
                member: serializeMember(r.row.user),
                join: { roleName: r.row.role.name },
            }
        case 'freeze': {
            const fromDate = dbDateToYmd(r.row.fromDate)
            return {
                ...base,
                requestId: r.row.id,
                member: serializeMember(r.row.user),
                freeze: {
                    fromDate,
                    untilDate: requestUntilYmd(fromDate, r.row.days),
                    days: r.row.days,
                    reason: r.row.reason,
                    planName: r.row.subscription.plan.name,
                    subscriptionId: r.row.subscriptionId,
                    subscriptionEndDate: r.row.subscription.endDate?.toISOString() ?? null,
                },
            }
        }
        case 'personal':
            return {
                ...base,
                requestId: r.row.id,
                member: serializeMember(r.row.member),
                personal: {
                    coach: { userId: r.row.coach.id, name: displayName(r.row.coach) },
                    gymName: r.row.gym?.name ?? null,
                    timezone: r.row.timezone,
                    memberComment: r.row.memberComment,
                    options: r.row.options.map((o) => ({
                        id: o.id,
                        startAt: o.startAt.toISOString(),
                        durationMin: o.durationMin,
                    })),
                },
            }
        case 'video':
            return {
                ...base,
                requestId: r.row.id,
                member: serializeMember(r.row.member),
                video: {
                    title: r.row.title,
                    message: r.row.message,
                    clipStatus: r.row.clip.status === 'ready' ? 'ready' : 'processing',
                    durationSec: r.row.clip.duration,
                    commentCount: r.row._count.comments,
                },
            }
    }
}
