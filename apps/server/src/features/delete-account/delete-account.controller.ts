import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Ip,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { SkipConsentCheck } from '../../shared/decorators/skip-consent-check.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    DeleteAccountFeature,
    DeleteAccountFeatureInputSchema,
    DeleteAccountFeatureOutputSchema,
    DeleteAccountFeatureResponse,
} from './delete-account.feature'

class DeleteAccountInput extends createZodDto(DeleteAccountFeatureInputSchema) {}

class DeleteAccountOutput extends createZodDto(
    DeleteAccountFeatureOutputSchema,
) {}

// Self-service account deletion (App Store 5.1.1(v)). A user permanently
// deletes their own account and all cascading data, proving it is them with
// a fresh code: the client first calls POST /send-auth-code for the
// account's own address, then posts that code here. Blocked server-side for
// club owners/coaches (they must hand off first). Withdrawing the
// personal-data consent is this deletion, so it stays reachable without one.
// A POST, not DELETE /me: the code travels in the body.
@Controller('me')
@UseGuards(AuthGuard)
@SkipConsentCheck()
export class DeleteAccountController {
    constructor(private bus: FeaturesBus) {}

    @Post('delete-account')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: DeleteAccountOutput })
    async deleteMyAccount(
        @Body() input: DeleteAccountInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string,
    ) {
        return await this.bus.execute<
            DeleteAccountFeature,
            DeleteAccountFeatureResponse
        >(new DeleteAccountFeature(input, user.userId, ip))
    }
}
