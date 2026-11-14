import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { CLUB_ADMINS, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetPaymentJournalEntryFeature,
    type GetPaymentJournalEntryFeatureResponse,
    PaymentJournalEntryDetailOutputSchema,
} from './get-payment-journal-entry.feature'
import {
    ListPaymentJournalFeature,
    type ListPaymentJournalFeatureResponse,
    ListPaymentJournalInputSchema,
    ListPaymentJournalOutputSchema,
} from './list-payment-journal.feature'

class ListPaymentJournalQuery extends createZodDto(ListPaymentJournalInputSchema) {}
class ListPaymentJournalOutput extends createZodDto(ListPaymentJournalOutputSchema) {}
class PaymentJournalEntryDetailOutput extends createZodDto(
    PaymentJournalEntryDetailOutputSchema,
) {}

@Controller('workspaces/:workspaceId/payment-journal')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PaymentJournalController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ListPaymentJournalOutput })
    async listPaymentJournal(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListPaymentJournalQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPaymentJournalFeature,
            ListPaymentJournalFeatureResponse
        >(
            new ListPaymentJournalFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    // entryId: `sub:<uuid>` / `reg:<uuid>` (the row's journal id).
    @Get(':entryId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: PaymentJournalEntryDetailOutput })
    async getPaymentJournalEntry(
        @Param('workspaceId') workspaceId: string,
        @Param('entryId') entryId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetPaymentJournalEntryFeature,
            GetPaymentJournalEntryFeatureResponse
        >(
            new GetPaymentJournalEntryFeature(
                entryId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
