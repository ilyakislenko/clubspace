import { z } from 'zod'

import { MyAutopaySchema } from './schemas'

// The member refuses autopay: effective at once, the saved card token is
// erased for good (376-ФЗ). Idempotent.
export const CancelMyAutopayOutputSchema = MyAutopaySchema

export class CancelMyAutopayFeature {
    constructor(
        readonly workspaceId: string,
        readonly autopayId: string,
        readonly invokerUserId: string,
    ) {}
}
export type CancelMyAutopayFeatureResponse = z.infer<typeof CancelMyAutopayOutputSchema>
