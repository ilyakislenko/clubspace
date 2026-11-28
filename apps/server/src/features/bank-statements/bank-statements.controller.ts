import { Body, Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { CLUB_ADMINS, Roles } from '../../shared/decorators/roles.decorator'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ConfirmBankStatementFeature,
    type ConfirmBankStatementFeatureResponse,
    ConfirmBankStatementInputSchema,
    ConfirmBankStatementOutputSchema,
    PreviewBankStatementFeature,
    type PreviewBankStatementFeatureResponse,
    PreviewBankStatementInputSchema,
    PreviewBankStatementOutputSchema,
} from './bank-statements.feature'
import { STATEMENT_MAX_BYTES } from './statement-parse'

class PreviewBankStatementForm extends createZodDto(PreviewBankStatementInputSchema) {}
class PreviewBankStatementOutput extends createZodDto(PreviewBankStatementOutputSchema) {}
class ConfirmBankStatementInput extends createZodDto(ConfirmBankStatementInputSchema) {}
class ConfirmBankStatementOutput extends createZodDto(ConfirmBankStatementOutputSchema) {}

// Multer's own ceiling, above the real limit: a too-big file gets the Russian
// message from the parser instead of multer's English 413.
const UPLOAD_HARD_LIMIT = STATEMENT_MAX_BYTES * 2

const columnProperty = { type: 'integer', minimum: 0, maximum: 199 } as const

// «Сверить выписку» (docs/design/2026-11-28-bank-statement-match.md): money,
// owner and admins only; both handlers re-check with assertClubAdmin. The
// file is read in memory and dropped with the request.
@Controller('workspaces/:workspaceId/bank-statements')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class BankStatementsController {
    constructor(private bus: FeaturesBus) {}

    @Post('preview')
    @Roles(CLUB_ADMINS)
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: {
                file: { type: 'string', format: 'binary' },
                dateColumn: columnProperty,
                amountColumn: columnProperty,
                payerColumn: columnProperty,
                purposeColumn: columnProperty,
            },
        },
    })
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT, files: 1 } }))
    @ZodResponse({ type: PreviewBankStatementOutput })
    async previewBankStatement(
        @Param('workspaceId') workspaceId: string,
        @Body() body: PreviewBankStatementForm,
        @UploadedFile() file: { buffer: Buffer } | undefined,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        if (!file) {
            throw new BadRequestError({ message: 'Прикрепите файл выписки' })
        }
        return await this.bus.execute<PreviewBankStatementFeature, PreviewBankStatementFeatureResponse>(
            new PreviewBankStatementFeature(
                body,
                { bytes: file.buffer },
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('confirm')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ConfirmBankStatementOutput })
    async confirmBankStatement(
        @Param('workspaceId') workspaceId: string,
        @Body() body: ConfirmBankStatementInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ConfirmBankStatementFeature, ConfirmBankStatementFeatureResponse>(
            new ConfirmBankStatementFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
