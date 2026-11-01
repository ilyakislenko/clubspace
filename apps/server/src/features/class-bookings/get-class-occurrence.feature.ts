import { z } from 'zod'

import { ClassOccurrenceOutputSchema } from './schemas'

export const ClassOccurrenceParamsSchema = z.object({
    slotId: z.string().uuid(),
    sessionDate: z.iso.date(),
})
export type ClassOccurrenceParams = z.infer<typeof ClassOccurrenceParamsSchema>

export const GetClassOccurrenceOutputSchema = ClassOccurrenceOutputSchema

export class GetClassOccurrenceFeature {
    constructor(
        readonly params: ClassOccurrenceParams,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetClassOccurrenceFeatureResponse = z.infer<
    typeof GetClassOccurrenceOutputSchema
>
