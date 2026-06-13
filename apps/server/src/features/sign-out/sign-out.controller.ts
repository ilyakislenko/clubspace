import { Body, Controller, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    SignOutFeature,
    SignOutFeatureInputSchema,
    SignOutFeatureOutputSchema,
    SignOutFeatureResponse,
} from './sign-out.feature'

class SignOutInput extends createZodDto(SignOutFeatureInputSchema) {}

class SignOutOutput extends createZodDto(SignOutFeatureOutputSchema) {}

@Controller()
export class SignOutController {
    constructor(private bus: FeaturesBus) {}

    @Post('sign-out')
    @ApiTags('Authentication')
    @ZodResponse({ type: SignOutOutput })
    async signOut(@Body() input: SignOutInput) {
        return await this.bus.execute<SignOutFeature, SignOutFeatureResponse>(
            new SignOutFeature(input),
        )
    }
}
