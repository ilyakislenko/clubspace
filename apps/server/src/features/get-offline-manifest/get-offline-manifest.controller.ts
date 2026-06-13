import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetOfflineManifestFeature,
    GetOfflineManifestFeatureOutputSchema,
    GetOfflineManifestFeatureResponse,
} from './get-offline-manifest.feature'

class GetOfflineManifestOutput extends createZodDto(
    GetOfflineManifestFeatureOutputSchema,
) {}

@Controller('videos')
@UseGuards(AuthGuard)
export class GetOfflineManifestController {
    constructor(private bus: FeaturesBus) {}

    @Get(':id/offline-manifest')
    @ZodResponse({ type: GetOfflineManifestOutput })
    async getOfflineManifest(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetOfflineManifestFeature,
            GetOfflineManifestFeatureResponse
        >(new GetOfflineManifestFeature(id, user.userId))
    }
}
