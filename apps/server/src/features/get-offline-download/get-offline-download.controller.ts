import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetOfflineDownloadFeature,
    GetOfflineDownloadFeatureOutputSchema,
    GetOfflineDownloadFeatureResponse,
} from './get-offline-download.feature'

class GetOfflineDownloadOutput extends createZodDto(
    GetOfflineDownloadFeatureOutputSchema,
) {}

@Controller('videos')
@UseGuards(AuthGuard)
export class GetOfflineDownloadController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id/offline-download')
    @ZodResponse({ type: GetOfflineDownloadOutput })
    async getOfflineDownload(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetOfflineDownloadFeature,
            GetOfflineDownloadFeatureResponse
        >(new GetOfflineDownloadFeature(id, user.userId))
    }
}
