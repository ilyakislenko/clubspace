import { z } from 'zod'

import { PublicClubSchema } from './schemas'

export const GetPublicClubFeatureOutputSchema = PublicClubSchema

// One feature for both public lookups: by the join code (any active club,
// listed or not — the person was handed the code) and by the slug (listed
// clubs only).
export class GetPublicClubFeature {
    constructor(
        readonly lookup: { kind: 'code'; code: string } | { kind: 'slug'; slug: string },
        // Midnight UTC of the current date; injectable for tests.
        readonly today: Date = new Date(new Date().toISOString().slice(0, 10)),
    ) {}
}

export type GetPublicClubFeatureResponse = z.infer<
    typeof GetPublicClubFeatureOutputSchema
>
