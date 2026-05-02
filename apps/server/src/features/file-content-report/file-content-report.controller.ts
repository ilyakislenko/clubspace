import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    FileContentReportFeature,
    FileContentReportFeatureInputSchema,
    FileContentReportFeatureOutputSchema,
    FileContentReportFeatureResponse,
} from './file-content-report.feature'

class FileContentReportInput extends createZodDto(
    FileContentReportFeatureInputSchema,
) {}

class FileContentReportOutput extends createZodDto(
    FileContentReportFeatureOutputSchema,
) {}

/**
 * Public endpoint: anyone (logged in or not) can file a content report.
 * Stricter rate limit because it has no auth gate.
 */
@Controller('reports')
export class FileContentReportController {
    constructor(private bus: FeaturesBus) {}

    @Post('content')
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @ZodResponse({ type: FileContentReportOutput })
    async fileReport(@Body() input: FileContentReportInput) {
        return await this.bus.execute<
            FileContentReportFeature,
            FileContentReportFeatureResponse
        >(new FileContentReportFeature(input))
    }
}
