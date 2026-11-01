import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    GetPublicPricingFeature,
    GetPublicPricingFeatureResponse,
    GetPublicPricingOutputSchema,
    QuotePublicPricingFeature,
    QuotePublicPricingFeatureResponse,
    QuotePublicPricingInputSchema,
    QuotePublicPricingOutputSchema,
} from './public-pricing.feature'

class GetPublicPricingOutput extends createZodDto(GetPublicPricingOutputSchema) {}
class QuotePublicPricingInputDto extends createZodDto(
    QuotePublicPricingInputSchema,
) {}
class QuotePublicPricingOutput extends createZodDto(
    QuotePublicPricingOutputSchema,
) {}

// Unauthenticated, per IP. The landing renders on the server (one address,
// cached for a few minutes); the calculator calls the quote from the browser
// as the visitor moves the slider (debounced), so the same budget as the
// other public reads covers it.
const PUBLIC_THROTTLE = {
    default: { ttl: 60_000, limit: 120, getTracker: trackByClientIp },
}

@Controller('public/pricing')
@ApiTags('Public')
export class PublicPricingController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: GetPublicPricingOutput })
    async getPublicPricing() {
        return await this.bus.execute<
            GetPublicPricingFeature,
            GetPublicPricingFeatureResponse
        >(new GetPublicPricingFeature())
    }

    // A computation, not a write: 200, like a read.
    @Post('quote')
    @HttpCode(200)
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: QuotePublicPricingOutput })
    async quotePublicPricing(@Body() body: QuotePublicPricingInputDto) {
        return await this.bus.execute<
            QuotePublicPricingFeature,
            QuotePublicPricingFeatureResponse
        >(new QuotePublicPricingFeature(body))
    }
}
