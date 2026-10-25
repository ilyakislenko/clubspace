import { z } from 'zod'

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

const MyGroupSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    role: z.enum(['coach', 'student']),
    // Effective IANA zone of the slots' wall-clock times (gym, else workspace).
    timezone: z.string(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    coach: z.object({
        id: z.string().uuid(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
        email: z.string(),
        phone: z.string().nullable(),
    }),
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
    slots: z.array(SlotSchema),
    exceptions: z.array(ExceptionSchema),
})

export const GetMyGroupsFeatureOutputSchema = z.object({
    data: z.array(MyGroupSchema),
})

export class GetMyGroupsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyGroupsFeatureResponse = z.infer<
    typeof GetMyGroupsFeatureOutputSchema
>
