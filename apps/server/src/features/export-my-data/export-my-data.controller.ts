import { Controller, Get, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { SkipConsentCheck } from '../../shared/decorators/skip-consent-check.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    ExportMyDataFeature,
    ExportMyDataFeatureOutputSchema,
    ExportMyDataFeatureResponse,
} from './export-my-data.feature'

class ExportMyDataOutput extends createZodDto(
    ExportMyDataFeatureOutputSchema,
) {}

@Controller('me/export')
@UseGuards(AuthGuard)
export class ExportMyDataController {
    constructor(private bus: FeaturesBus) {}

    // A JSON file download. Reachable without the current consent: the right
    // to see one's own data does not depend on agreeing to new terms. The
    // hourly limit keeps a looping client from rebuilding it nonstop.
    @Get()
    @SkipConsentCheck()
    @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
    @ZodResponse({ type: ExportMyDataOutput })
    async exportMyData(
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ) {
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="clubspace-my-data-${new Date()
                .toISOString()
                .slice(0, 10)}.json"`,
        )
        return await this.bus.execute<
            ExportMyDataFeature,
            ExportMyDataFeatureResponse
        >(new ExportMyDataFeature(user.userId))
    }
}
