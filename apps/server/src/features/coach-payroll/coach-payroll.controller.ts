import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { CLUB_ADMINS, Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddPayrollAdjustmentFeature,
    AddPayrollAdjustmentInputSchema,
    AddPayrollAdjustmentOutputSchema,
    type AddPayrollAdjustmentFeatureResponse,
} from './add-payroll-adjustment.feature'
import {
    ClosePayrollMonthFeature,
    ClosePayrollMonthInputSchema,
    type ClosePayrollMonthFeatureResponse,
} from './close-payroll-month.feature'
import {
    DeletePayrollAdjustmentFeature,
    DeletePayrollAdjustmentOutputSchema,
    type DeletePayrollAdjustmentFeatureResponse,
} from './delete-payroll-adjustment.feature'
import {
    GetMyPayrollFeature,
    GetMyPayrollOutputSchema,
    type GetMyPayrollFeatureResponse,
} from './get-my-payroll.feature'
import {
    GetPayrollMonthFeature,
    GetPayrollMonthInputSchema,
    type GetPayrollMonthFeatureResponse,
} from './get-payroll-month.feature'
import {
    ListCoachRatesFeature,
    ListCoachRatesOutputSchema,
    type ListCoachRatesFeatureResponse,
} from './list-coach-rates.feature'
import {
    ListPayrollClassesFeature,
    ListPayrollClassesInputSchema,
    ListPayrollClassesOutputSchema,
    type ListPayrollClassesFeatureResponse,
} from './list-payroll-classes.feature'
import {
    ReopenPayrollMonthFeature,
    ReopenPayrollMonthInputSchema,
    type ReopenPayrollMonthFeatureResponse,
} from './reopen-payroll-month.feature'
import { PayrollMonthOutputSchema } from './schemas'
import {
    CoachRateOutputSchema,
    SetCoachRateFeature,
    SetCoachRateInputSchema,
    type SetCoachRateFeatureResponse,
} from './set-coach-rate.feature'

class GetPayrollMonthQuery extends createZodDto(GetPayrollMonthInputSchema) {}
class PayrollMonthOutput extends createZodDto(PayrollMonthOutputSchema) {}
class ListPayrollClassesQuery extends createZodDto(ListPayrollClassesInputSchema) {}
class PayrollClassesOutput extends createZodDto(ListPayrollClassesOutputSchema) {}
class CoachRatesOutput extends createZodDto(ListCoachRatesOutputSchema) {}
class SetCoachRateInput extends createZodDto(SetCoachRateInputSchema) {}
class CoachRateOutput extends createZodDto(CoachRateOutputSchema) {}
class AddPayrollAdjustmentInput extends createZodDto(AddPayrollAdjustmentInputSchema) {}
class PayrollAdjustmentOutput extends createZodDto(AddPayrollAdjustmentOutputSchema) {}
class DeletePayrollAdjustmentOutput extends createZodDto(DeletePayrollAdjustmentOutputSchema) {}
class ClosePayrollMonthInput extends createZodDto(ClosePayrollMonthInputSchema) {}
class ReopenPayrollMonthInput extends createZodDto(ReopenPayrollMonthInputSchema) {}
class MyPayrollOutput extends createZodDto(GetMyPayrollOutputSchema) {}

// «Выплаты тренерам» (docs/design/2026-11-26-coach-payroll.md §3.2): club
// money — owner and admins; the coach's own closed months are a staff read.
@Controller('workspaces/:workspaceId/payroll')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class CoachPayrollController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PayrollMonthOutput })
    async getPayrollMonth(
        @Param('workspaceId') workspaceId: string,
        @Query() query: GetPayrollMonthQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetPayrollMonthFeature, GetPayrollMonthFeatureResponse>(
            new GetPayrollMonthFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('me')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: MyPayrollOutput })
    async getMyPayroll(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetMyPayrollFeature, GetMyPayrollFeatureResponse>(
            new GetMyPayrollFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('rates')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: CoachRatesOutput })
    async listCoachRates(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListCoachRatesFeature, ListCoachRatesFeatureResponse>(
            new ListCoachRatesFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get('coaches/:coachId/classes')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PayrollClassesOutput })
    async listPayrollClasses(
        @Param('workspaceId') workspaceId: string,
        @Param('coachId') coachId: string,
        @Query() query: ListPayrollClassesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPayrollClassesFeature,
            ListPayrollClassesFeatureResponse
        >(
            new ListPayrollClassesFeature(
                query,
                workspaceId,
                coachId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put('rates/:coachId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: CoachRateOutput })
    async setCoachRate(
        @Param('workspaceId') workspaceId: string,
        @Param('coachId') coachId: string,
        @Body() body: SetCoachRateInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<SetCoachRateFeature, SetCoachRateFeatureResponse>(
            new SetCoachRateFeature(
                body,
                workspaceId,
                coachId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('adjustments')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PayrollAdjustmentOutput })
    async addPayrollAdjustment(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AddPayrollAdjustmentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddPayrollAdjustmentFeature,
            AddPayrollAdjustmentFeatureResponse
        >(
            new AddPayrollAdjustmentFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('adjustments/:adjustmentId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: DeletePayrollAdjustmentOutput })
    async deletePayrollAdjustment(
        @Param('workspaceId') workspaceId: string,
        @Param('adjustmentId') adjustmentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeletePayrollAdjustmentFeature,
            DeletePayrollAdjustmentFeatureResponse
        >(
            new DeletePayrollAdjustmentFeature(
                workspaceId,
                adjustmentId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':month/close')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PayrollMonthOutput })
    async closePayrollMonth(
        @Param('workspaceId') workspaceId: string,
        @Param('month') month: string,
        @Body() body: ClosePayrollMonthInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ClosePayrollMonthFeature, ClosePayrollMonthFeatureResponse>(
            new ClosePayrollMonthFeature(
                body,
                workspaceId,
                month,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':month/reopen')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PayrollMonthOutput })
    async reopenPayrollMonth(
        @Param('workspaceId') workspaceId: string,
        @Param('month') month: string,
        @Body() body: ReopenPayrollMonthInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ReopenPayrollMonthFeature,
            ReopenPayrollMonthFeatureResponse
        >(
            new ReopenPayrollMonthFeature(
                body,
                workspaceId,
                month,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
