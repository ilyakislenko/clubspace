import { z } from 'zod'

import { ClubAboutOutputSchema } from './schemas'

export const UpdateClubAboutFeatureInputSchema = z.object({
    contacts: z
        .array(
            z.object({
                label: z.string().trim().min(1).max(120),
                phone: z.string().trim().min(1).max(32),
            }),
        )
        .max(10),
    links: z
        .array(
            z.object({
                label: z.string().trim().min(1).max(60),
                // Reject any non-http(s) scheme so javascript:/data: URIs
                // cannot be persisted and later opened from the app.
                url: z
                    .string()
                    .trim()
                    .max(500)
                    .refine(
                        (v) => {
                            try {
                                const u = new URL(v)
                                return (
                                    u.protocol === 'http:' ||
                                    u.protocol === 'https:'
                                )
                            } catch {
                                return false
                            }
                        },
                        {
                            message:
                                'Ссылка должна начинаться с http:// или https://',
                        },
                    ),
            }),
        )
        .max(10),
    rules: z.string().trim().max(10000).nullable(),
})

export const UpdateClubAboutFeatureOutputSchema = ClubAboutOutputSchema

export class UpdateClubAboutFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateClubAboutFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateClubAboutFeatureResponse = z.infer<
    typeof UpdateClubAboutFeatureOutputSchema
>
