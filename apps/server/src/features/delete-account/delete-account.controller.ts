import {
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
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
    DeleteAccountFeature,
    DeleteAccountFeatureOutputSchema,
    DeleteAccountFeatureResponse,
} from './delete-account.feature'

class DeleteAccountOutput extends createZodDto(
    DeleteAccountFeatureOutputSchema,
) {}

// Self-service account deletion (App Store 5.1.1(v)). A user permanently
// deletes their own account and all cascading data. Blocked server-side for
// club owners/coaches (they must hand off first).
@Controller('me')
@UseGuards(AuthGuard)
export class DeleteAccountController {
    constructor(private bus: FeaturesBus) {}

    @Delete()
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: DeleteAccountOutput })
    async delete(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            DeleteAccountFeature,
            DeleteAccountFeatureResponse
        >(new DeleteAccountFeature(user.userId))
    }
}
