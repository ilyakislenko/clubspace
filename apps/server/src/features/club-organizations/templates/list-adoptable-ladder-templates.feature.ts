import { z } from 'zod'

export const AdoptableLadderTemplateOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    name: z.string(),
    audience: z.string().nullable(),
    version: z.number().int(),
    levels: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            order: z.number().int(),
            color: z.string().nullable(),
            maxStripes: z.number().int(),
        }),
    ),
    // This club's ladders copied from it (any direction), with the version
    // each took.
    adoptedLadders: z.array(
        z.object({
            ladderId: z.string().uuid(),
            ladderName: z.string(),
            templateVersion: z.number().int(),
        }),
    ),
})
export const ListAdoptableLadderTemplatesOutputSchema = z.object({
    data: z.array(AdoptableLadderTemplateOutputSchema),
})

export class ListAdoptableLadderTemplatesFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListAdoptableLadderTemplatesFeatureResponse = z.infer<
    typeof ListAdoptableLadderTemplatesOutputSchema
>
