import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    GetPublicLegalFeature,
    type GetPublicLegalFeatureResponse,
    GetPublicLegalOutputSchema,
} from './get-public-legal.feature'

class GetPublicLegalOutput extends createZodDto(GetPublicLegalOutputSchema) {}

// Unauthenticated: the public site's /legal/offer, /legal/dpa and
// /legal/requisites render the current editions and the seller's requisites
// from it (cached by the web host). Per IP, like the other public routes.
@Controller('public/legal')
@ApiTags('Public')
export class PublicLegalController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Throttle({ default: { ttl: 60_000, limit: 120, getTracker: trackByClientIp } })
    @ZodResponse({ type: GetPublicLegalOutput })
    async getPublicLegal() {
        return await this.bus.execute<GetPublicLegalFeature, GetPublicLegalFeatureResponse>(
            new GetPublicLegalFeature(),
        )
    }
}
