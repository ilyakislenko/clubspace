import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
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
import { TelegramStatusOutputSchema } from './schemas'
import {
    CreateTelegramLinkFeature,
    CreateTelegramLinkFeatureResponse,
    GetMyTelegramFeature,
    GetMyTelegramFeatureResponse,
    TelegramLinkOutputSchema,
    UnlinkMyTelegramFeature,
    UnlinkMyTelegramFeatureResponse,
    UpdateMyTelegramFeature,
    UpdateMyTelegramFeatureResponse,
    UpdateMyTelegramInputSchema,
} from './telegram-link.feature'

class TelegramStatusOutput extends createZodDto(TelegramStatusOutputSchema) {}
class TelegramLinkOutput extends createZodDto(TelegramLinkOutputSchema) {}
class UpdateMyTelegramInput extends createZodDto(UpdateMyTelegramInputSchema) {}

// The signed-in user's own Telegram chat for notifications. A guardian links
// their own chat; X-Act-As is refused here (user-level route).
@Controller('me/telegram')
@UseGuards(AuthGuard)
export class TelegramLinkController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: TelegramStatusOutput })
    async getMyTelegram(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<GetMyTelegramFeature, GetMyTelegramFeatureResponse>(
            new GetMyTelegramFeature(user.userId),
        )
    }

    @Post('link')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: TelegramLinkOutput })
    async createTelegramLink(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            CreateTelegramLinkFeature,
            CreateTelegramLinkFeatureResponse
        >(new CreateTelegramLinkFeature(user.userId))
    }

    @Patch()
    @ZodResponse({ type: TelegramStatusOutput })
    async updateMyTelegram(
        @CurrentUser() user: CurrentUserPayload,
        @Body() body: UpdateMyTelegramInput,
    ) {
        return await this.bus.execute<
            UpdateMyTelegramFeature,
            UpdateMyTelegramFeatureResponse
        >(new UpdateMyTelegramFeature(user.userId, body))
    }

    @Delete()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: TelegramStatusOutput })
    async unlinkMyTelegram(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            UnlinkMyTelegramFeature,
            UnlinkMyTelegramFeatureResponse
        >(new UnlinkMyTelegramFeature(user.userId))
    }
}
