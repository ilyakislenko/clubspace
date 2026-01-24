import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    ResendCodeFeature,
    ResendCodeFeatureInputSchema,
    ResendCodeFeatureOutputSchema,
    ResendCodeFeatureResponse,
} from './resend-code.feature'

class ResendCodeInput extends createZodDto(ResendCodeFeatureInputSchema) {}

class ResendCodeOutput extends createZodDto(ResendCodeFeatureOutputSchema) {}

@Controller()
export class ResendCodeController {
    constructor(private bus: FeaturesBus) {}

    @Post('resend-code')
    @ApiTags('Authentication')
    @ZodResponse({ type: ResendCodeOutput })
    async resendCode(@Body() input: ResendCodeInput) {
        return await this.bus.execute<
            ResendCodeFeature,
            ResendCodeFeatureResponse
        >(new ResendCodeFeature(input))
    }
}
