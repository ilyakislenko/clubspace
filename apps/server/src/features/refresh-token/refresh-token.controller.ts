import { Controller, Post, Body } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    RefreshTokenFeature,
    RefreshTokenFeatureInputSchema,
    RefreshTokenFeatureOutputSchema,
    RefreshTokenFeatureResponse,
} from './refresh-token.feature'
import { ApiTags } from '@nestjs/swagger'

class RefreshTokenInput extends createZodDto(RefreshTokenFeatureInputSchema) {}

class RefreshTokenOutput extends createZodDto(
    RefreshTokenFeatureOutputSchema,
) {}

@Controller()
export class RefreshTokenController {
    constructor(private bus: FeaturesBus) {}

    @Post('refresh-token')
    @ApiTags('Authentication')
    @ZodResponse({ type: RefreshTokenOutput })
    async refreshToken(@Body() input: RefreshTokenInput) {
        return await this.bus.execute<
            RefreshTokenFeature,
            RefreshTokenFeatureResponse
        >(new RefreshTokenFeature(input))
    }
}
