import { z } from 'zod'

import { MyAutopaySchema } from './schemas'

// The member's autopay agreements in this club: live ones and those
// cancelled in the last 30 days (the written confirmation stays visible).
export const ListMyAutopaysOutputSchema = z.object({
    data: z.array(MyAutopaySchema),
})

export class ListMyAutopaysFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}
export type ListMyAutopaysFeatureResponse = z.infer<typeof ListMyAutopaysOutputSchema>
