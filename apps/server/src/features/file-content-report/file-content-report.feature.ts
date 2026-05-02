import { z } from 'zod'

export const FileContentReportFeatureInputSchema = z.object({
    /** Optional video id if the report is about a specific video. */
    videoId: z.string().uuid().optional(),
    /** Reporter contact (email or name + how to reach). */
    reporterContact: z.string().min(3).max(500),
    /** Free-text describing the issue (DMCA, copyright, abuse, etc.). */
    reason: z.string().min(10).max(5000),
})

export const FileContentReportFeatureOutputSchema = z.object({
    status: z.literal('received'),
    referenceId: z.string().uuid(),
})

export class FileContentReportFeature {
    constructor(
        readonly payload: z.infer<typeof FileContentReportFeatureInputSchema>,
    ) {}
}

export type FileContentReportFeatureResponse = z.infer<
    typeof FileContentReportFeatureOutputSchema
>
