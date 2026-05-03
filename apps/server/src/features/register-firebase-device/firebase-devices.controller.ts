import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    RegisterFirebaseDeviceFeature,
    RegisterFirebaseDeviceFeatureInputSchema,
    RegisterFirebaseDeviceFeatureOutputSchema,
    RegisterFirebaseDeviceFeatureResponse,
} from './register-firebase-device.feature'
import {
    UnregisterFirebaseDeviceFeature,
    UnregisterFirebaseDeviceFeatureInputSchema,
    UnregisterFirebaseDeviceFeatureOutputSchema,
    UnregisterFirebaseDeviceFeatureResponse,
} from './unregister-firebase-device.feature'

class RegisterDeviceInput extends createZodDto(
    RegisterFirebaseDeviceFeatureInputSchema,
) {}

class RegisterDeviceOutput extends createZodDto(
    RegisterFirebaseDeviceFeatureOutputSchema,
) {}

class UnregisterDeviceInput extends createZodDto(
    UnregisterFirebaseDeviceFeatureInputSchema,
) {}

class UnregisterDeviceOutput extends createZodDto(
    UnregisterFirebaseDeviceFeatureOutputSchema,
) {}

@Controller('me/firebase-devices')
@UseGuards(AuthGuard)
export class FirebaseDevicesController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: RegisterDeviceOutput })
    async register(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: RegisterDeviceInput,
    ) {
        return await this.bus.execute<
            RegisterFirebaseDeviceFeature,
            RegisterFirebaseDeviceFeatureResponse
        >(new RegisterFirebaseDeviceFeature(user.userId, body))
    }

    @Delete()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: UnregisterDeviceOutput })
    async unregister(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: UnregisterDeviceInput,
    ) {
        return await this.bus.execute<
            UnregisterFirebaseDeviceFeature,
            UnregisterFirebaseDeviceFeatureResponse
        >(new UnregisterFirebaseDeviceFeature(user.userId, body.token))
    }
}
