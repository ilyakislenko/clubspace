import { z } from 'zod'

export const ListAuditEventsFeatureInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().optional(),
})

export const ListAuditEventsFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid().nullable(),
            actorId: z.string().uuid().nullable(),
            actorEmail: z.string().nullable(),
            actorLabel: z.string().nullable(),
            action: z.string(),
            targetType: z.string(),
            targetId: z.string().nullable(),
            targetLabel: z.string().nullable(),
            metadata: z.unknown().nullable(),
            createdAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListAuditEventsFeature {
    constructor(
        readonly payload: z.infer<typeof ListAuditEventsFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAuditEventsFeatureResponse = z.infer<
    typeof ListAuditEventsFeatureOutputSchema
>
