import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    SendAuthCodeFeature,
    SendAuthCodeFeatureInputSchema,
    SendAuthCodeFeatureOutputSchema,
    SendAuthCodeFeatureResponse,
} from './send-auth-code.feature'

class SendAuthCodeInput extends createZodDto(SendAuthCodeFeatureInputSchema) {}

class SendAuthCodeOutput extends createZodDto(
    SendAuthCodeFeatureOutputSchema,
) {}

@Controller()
export class SendAuthCodeController {
    constructor(private bus: FeaturesBus) {}

    @Post('send-auth-code')
    @ApiTags('Authentication')
    @ZodResponse({ type: SendAuthCodeOutput })
    async sendAuthCode(@Body() input: SendAuthCodeInput) {
        return await this.bus.execute<
            SendAuthCodeFeature,
            SendAuthCodeFeatureResponse
        >(new SendAuthCodeFeature(input))
    }
}
