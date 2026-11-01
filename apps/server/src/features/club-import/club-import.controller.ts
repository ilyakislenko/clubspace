import {
    Body,
    Controller,
    Get,
    Header,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import { CLUB_IMPORT_MAX_BYTES } from './club-import-csv'
import {
    ApplyClubImportFeature,
    ApplyClubImportOutputSchema,
    type ClubImportFeatureResponse,
    GetClubImportFeature,
    GetClubImportOutputSchema,
    GetClubImportTemplateFeature,
    ListClubImportRowsFeature,
    type ListClubImportRowsFeatureResponse,
    ListClubImportRowsOutputSchema,
    ListClubImportRowsQuerySchema,
    PreviewClubImportFeature,
    PreviewClubImportInputSchema,
    PreviewClubImportOutputSchema,
    UploadClubImportFeature,
    UploadClubImportOutputSchema,
} from './club-import.feature'

class UploadClubImportOutput extends createZodDto(UploadClubImportOutputSchema) {}
class GetClubImportOutput extends createZodDto(GetClubImportOutputSchema) {}
class PreviewClubImportBody extends createZodDto(PreviewClubImportInputSchema) {}
class PreviewClubImportOutput extends createZodDto(PreviewClubImportOutputSchema) {}
class ApplyClubImportOutput extends createZodDto(ApplyClubImportOutputSchema) {}
class ListClubImportRowsQuery extends createZodDto(ListClubImportRowsQuerySchema) {}
class ListClubImportRowsOutput extends createZodDto(ListClubImportRowsOutputSchema) {}

// Multer's own ceiling, well above the real limit: a too-big file gets the
// Russian «больше 2 МБ» from the parser instead of multer's English 413.
const UPLOAD_HARD_LIMIT = CLUB_IMPORT_MAX_BYTES * 4

// «Импорт клуба» (members, groups, abonements, ranks from a CSV). Admin and
// head coach only; every handler re-checks with assertWorkspaceAdmin.
@Controller('workspaces/:workspaceId/club-imports')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubImportController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(WORKSPACE_ADMINS)
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    @UseInterceptors(
        FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT, files: 1 } }),
    )
    @ZodResponse({ type: UploadClubImportOutput })
    async uploadClubImport(
        @Param('workspaceId') workspaceId: string,
        @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        if (!file) {
            throw new BadRequestError({ message: 'Прикрепите CSV-файл' })
        }
        return await this.bus.execute<UploadClubImportFeature, ClubImportFeatureResponse>(
            new UploadClubImportFeature(
                {
                    // Multer reads the name as latin1; browsers send UTF-8.
                    fileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
                    bytes: file.buffer,
                },
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('template.csv')
    @Roles(WORKSPACE_ADMINS)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async getClubImportTemplate(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="club-import-template.csv"',
        )
        return await this.bus.execute<GetClubImportTemplateFeature, string>(
            new GetClubImportTemplateFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':importId')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: GetClubImportOutput })
    async getClubImport(
        @Param('workspaceId') workspaceId: string,
        @Param('importId', ParseUUIDPipe) importId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetClubImportFeature, ClubImportFeatureResponse>(
            new GetClubImportFeature(
                importId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':importId/rows')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ListClubImportRowsOutput })
    async listClubImportRows(
        @Param('workspaceId') workspaceId: string,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Query() query: ListClubImportRowsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListClubImportRowsFeature,
            ListClubImportRowsFeatureResponse
        >(
            new ListClubImportRowsFeature(
                query,
                importId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':importId/preview')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: PreviewClubImportOutput })
    async previewClubImport(
        @Param('workspaceId') workspaceId: string,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() body: PreviewClubImportBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<PreviewClubImportFeature, ClubImportFeatureResponse>(
            new PreviewClubImportFeature(
                body,
                importId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':importId/apply')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ApplyClubImportOutput })
    async applyClubImport(
        @Param('workspaceId') workspaceId: string,
        @Param('importId', ParseUUIDPipe) importId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ApplyClubImportFeature, ClubImportFeatureResponse>(
            new ApplyClubImportFeature(
                importId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
