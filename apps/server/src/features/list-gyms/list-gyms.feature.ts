import { z } from 'zod'

const GymRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    timezone: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    groupCount: z.number().int(),
    createdAt: z.iso.datetime(),
})

export const ListGymsFeatureOutputSchema = z.object({
    data: z.array(GymRowSchema),
    total: z.number().int(),
})

export class ListGymsFeature {
    constructor(readonly workspaceId: string) {}
}

export type ListGymsFeatureResponse = z.infer<
    typeof ListGymsFeatureOutputSchema
>
