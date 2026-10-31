import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import {
    GetPublicClubFeature,
    GetPublicClubFeatureOutputSchema,
    type GetPublicClubFeatureResponse,
} from './get-public-club.feature'
import {
    SearchPublicClubsFeature,
    SearchPublicClubsFeatureInputSchema,
    SearchPublicClubsFeatureOutputSchema,
    type SearchPublicClubsFeatureResponse,
} from './search-public-clubs.feature'

class PublicClubOutputDto extends createZodDto(
    GetPublicClubFeatureOutputSchema,
) {}
class SearchPublicClubsQuery extends createZodDto(
    SearchPublicClubsFeatureInputSchema,
) {}
class SearchPublicClubsOutputDto extends createZodDto(
    SearchPublicClubsFeatureOutputSchema,
) {}

// Unauthenticated: the join preview, the public club page and club search on
// app.<domain>. Per IP, always (trackByClientIp). Server-rendered pages reach
// this from the web host's single address, so the limits are sized for that,
// and the web host caches responses for a minute. Join codes are 8 characters
// out of 31, so even this rate makes guessing one hopeless.
const PUBLIC_THROTTLE = {
    default: { ttl: 60_000, limit: 120, getTracker: trackByClientIp },
}

@Controller('public/clubs')
@ApiTags('Public')
export class PublicClubsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: SearchPublicClubsOutputDto })
    async searchPublicClubs(@Query() query: SearchPublicClubsQuery) {
        return await this.bus.execute<
            SearchPublicClubsFeature,
            SearchPublicClubsFeatureResponse
        >(new SearchPublicClubsFeature(query))
    }

    // Any active code, listed club or not: whoever holds the code was handed
    // it by the club.
    @Get('by-code/:code')
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: PublicClubOutputDto })
    async getPublicClubByCode(@Param('code') code: string) {
        return await this.bus.execute<
            GetPublicClubFeature,
            GetPublicClubFeatureResponse
        >(new GetPublicClubFeature({ kind: 'code', code }))
    }

    @Get(':slug')
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: PublicClubOutputDto })
    async getPublicClubBySlug(@Param('slug') slug: string) {
        return await this.bus.execute<
            GetPublicClubFeature,
            GetPublicClubFeatureResponse
        >(new GetPublicClubFeature({ kind: 'slug', slug }))
    }
}
