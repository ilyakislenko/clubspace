import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'

import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import { ExportService } from './export.service'

const attach = (res: Response, name: string) => {
    const date = new Date().toISOString().slice(0, 10)
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name}-${date}.csv"`,
    )
}

// CSV exports for accounting/roster. Admin-only (member contacts + revenue are
// sensitive). Returns raw text/csv, so no ZodResponse — like the manifest proxy.
@Controller('workspaces/:workspaceId/exports')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ExportController {
    constructor(private readonly exportService: ExportService) {}

    @Get('members.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async members(
        @Param('workspaceId') workspaceId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'members')
        return await this.exportService.membersCsv(workspaceId)
    }

    @Get('attendance.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async attendance(
        @Param('workspaceId') workspaceId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'attendance')
        return await this.exportService.attendanceCsv(workspaceId)
    }

    @Get('revenue.csv')
    @Roles(STAFF_ROLES)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    async revenue(
        @Param('workspaceId') workspaceId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        attach(res, 'revenue')
        return await this.exportService.revenueCsv(workspaceId)
    }
}
