import { z } from 'zod'

export const ListRolesFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            superuser: z.boolean(),
            editable: z.boolean(),
        }),
    ),
})

export class ListRolesFeature {}

export type ListRolesFeatureResponse = z.infer<
    typeof ListRolesFeatureOutputSchema
>
