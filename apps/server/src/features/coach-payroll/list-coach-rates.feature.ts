import { z } from 'zod'

import { CoachRateOutputSchema } from './set-coach-rate.feature'

// The staff (owner + active coaching members) and each one's rate history.
export const ListCoachRatesOutputSchema = z.object({
    // The club's payroll currency (dominant tariff currency, else RUB).
    currency: z.string(),
    coaches: z.array(
        z.object({
            coachId: z.string().uuid(),
            name: z.string(),
            // 'owner' or the member's role name.
            role: z.string(),
            // The newest change of any of this coach's rates: the rate form
            // sends it back as `expectedUpdatedAt`. null = no rate yet.
            updatedAt: z.iso.datetime().nullable(),
            // Newest month first.
            rates: z.array(CoachRateOutputSchema),
        }),
    ),
})

export class ListCoachRatesFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListCoachRatesFeatureResponse = z.infer<typeof ListCoachRatesOutputSchema>
