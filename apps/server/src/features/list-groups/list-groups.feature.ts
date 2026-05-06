import { z } from 'zod'

const GroupMemberSchema = z.object({
    userId: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    joinedAt: z.iso.datetime(),
})

const SlotSchema = z.object({
    id: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
    durationMin: z.number().int(),
    effectiveFrom: z.iso.date().nullable(),
    effectiveUntil: z.iso.date().nullable(),
})

const ExceptionSchema = z.object({
    id: z.string().uuid(),
    slotId: z.string().uuid().nullable(),
    fromDate: z.iso.date(),
    untilDate: z.iso.date(),
    reason: z.string().nullable(),
})

const GroupRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    coach: z.object({
        id: z.string().uuid(),
        email: z.string(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
    }),
    // Full coach roster including the primary (mirrored from `coach`
    // above). Clients can pick the right rendering: chip per coach, or
    // primary + "+ N помощников".
    coaches: z.array(
        z.object({
            userId: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
            role: z.enum(['primary', 'assistant']),
        }),
    ),
    memberCount: z.number().int(),
    members: z.array(GroupMemberSchema),
    slots: z.array(SlotSchema),
    exceptions: z.array(ExceptionSchema),
    createdAt: z.iso.datetime(),
})

export const ListGroupsFeatureOutputSchema = z.object({
    data: z.array(GroupRowSchema),
    total: z.number().int(),
})

export class ListGroupsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly filters: { coachId?: string } = {},
    ) {}
}

export type ListGroupsFeatureResponse = z.infer<
    typeof ListGroupsFeatureOutputSchema
>
