import { Body, Controller, Get, Headers, Ip, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { PUBLIC_THROTTLE } from '../public-clubs/public-clubs.controller'
import {
    CreatePublicTrialRequestFeature,
    type CreatePublicTrialRequestFeatureResponse,
    CreatePublicTrialRequestInputSchema,
    CreatePublicTrialRequestOutputSchema,
} from './create-public-trial-request.feature'
import {
    GetPublicTrialFormFeature,
    type GetPublicTrialFormFeatureResponse,
    GetPublicTrialFormOutputSchema,
} from './get-public-trial-form.feature'

class PublicTrialFormOutput extends createZodDto(GetPublicTrialFormOutputSchema) {}
class CreatePublicTrialRequestInput extends createZodDto(CreatePublicTrialRequestInputSchema) {}
class CreatePublicTrialRequestOutput extends createZodDto(CreatePublicTrialRequestOutputSchema) {}

// Per IP and hourly: a person sends one or two, a script hits the wall at the
// eleventh. Wider than the demo form's 5 because Russian mobile carriers put
// many people behind one address (CGNAT); the club's daily cap and the
// duplicate merge are the real guard. Exported so it can be raised.
export const TRIAL_REQUEST_THROTTLE = {
    default: { ttl: 3_600_000, limit: 10, getTracker: trackByClientIp },
}

// «Записаться на пробное» on app.<domain>/c/<slug>/trial
// (docs/design/2026-11-26-leads.md §3.2). Unauthenticated, like
// public/demo-requests; the form answers 404 unless the club takes requests.
@Controller('public/clubs/:slug/trial')
@ApiTags('Public')
export class PublicTrialRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Throttle(PUBLIC_THROTTLE)
    @ZodResponse({ type: PublicTrialFormOutput })
    async getPublicTrialForm(@Param('slug') slug: string) {
        return await this.bus.execute<
            GetPublicTrialFormFeature,
            GetPublicTrialFormFeatureResponse
        >(new GetPublicTrialFormFeature(slug))
    }

    @Post()
    @Throttle(TRIAL_REQUEST_THROTTLE)
    @ZodResponse({ type: CreatePublicTrialRequestOutput })
    async createPublicTrialRequest(
        @Param('slug') slug: string,
        @Body() body: CreatePublicTrialRequestInput,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return await this.bus.execute<
            CreatePublicTrialRequestFeature,
            CreatePublicTrialRequestFeatureResponse
        >(new CreatePublicTrialRequestFeature(body, slug, ip ?? null, userAgent ?? null))
    }
}
