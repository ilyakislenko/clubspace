import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

// Coach-editable session metadata. Only `notes` today (e.g. "belt test day",
// "focused on guard passing"); nullable to clear it.
export const UpdateSessionInputSchema = z.object({
    notes: z.string().max(2000).nullable(),
})

export const UpdateSessionOutputSchema = AttendanceSessionOutputSchema

export class UpdateSessionFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateSessionInputSchema>,
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateSessionFeatureResponse = z.infer<
    typeof UpdateSessionOutputSchema
>
