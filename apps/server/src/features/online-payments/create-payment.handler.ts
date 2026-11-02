import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isWorkspaceEntitled } from '../../domains/billing/module-entitlement'
import {
    onlineGrantStart,
    sameScopeAbonements,
} from '../../domains/payments/online-grant-start'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { scopeDirectionIds } from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import {
    CreatePaymentFeature,
    CreatePaymentFeatureResponse,
} from './create-payment.feature'
import {
    loadBuyer,
    onlinePaymentsUnavailableError,
    PENDING_REUSE_MS,
    purchasablePlanWhere,
    sectionDisabledError,
} from './load-buyer'
import { serializeMyPayment } from './schemas'
import { startProviderPayment } from './start-provider-payment'

// The member buys a tariff online (startProviderPayment). The abonement is
// created only by the webhook, never here.
@Feature(CreatePaymentFeature)
export class CreatePaymentHandler
    implements IFeatureHandler<CreatePaymentFeature, CreatePaymentFeatureResponse>
{
    private readonly logger = new Logger(CreatePaymentHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
    ) {}

    async execute(f: CreatePaymentFeature): Promise<CreatePaymentFeatureResponse> {
        const { workspace, member } = await loadBuyer(this.prisma, f)
        if (!workspace.subscriptionEnabled) throw sectionDisabledError()
        if (!isWorkspaceEntitled(workspace)) throw onlinePaymentsUnavailableError()
        if (f.userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный, абонемент не нужен',
            })
        }
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const settings = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        if (!settings) {
            throw new BadRequestError({ message: 'Клуб не принимает онлайн-оплату' })
        }
        const plan = await this.prisma.plan.findFirst({
            where: { ...purchasablePlanWhere(f.workspaceId), id: f.payload.planId },
            select: {
                id: true,
                name: true,
                price: true,
                currency: true,
                directions: { select: { directionId: true } },
            },
        })
        if (!plan) {
            throw new NotFoundError({
                message: 'Этот тариф нельзя купить онлайн',
            })
        }
        const now = new Date()
        const start = onlineGrantStart(
            sameScopeAbonements(member.subscriptions, scopeDirectionIds(plan)),
            workspace.timezone,
            now,
            vocabularyForWorkspaceType(workspace.type),
        )
        if (start.kind === 'blocked') {
            throw new BadRequestError({ message: start.message })
        }

        // A repeated tap (or a member who came back from the provider's page
        // without paying) gets the same payment instead of a second one.
        const recent = await this.prisma.payment.findFirst({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                planId: plan.id,
                provider: settings.provider,
                status: 'PENDING',
                confirmationUrl: { not: null },
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
        })
        if (recent?.confirmationUrl) {
            return {
                payment: serializeMyPayment(recent),
                confirmationUrl: recent.confirmationUrl,
            }
        }

        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: f.userId },
            select: { email: true },
        })
        // A child profile (a guardian acting for it) has no e-mail for the
        // receipt; paying for a child online is not offered yet.
        if (user.email === null) {
            throw new BadRequestError({
                message:
                    'Оплатить абонемент ребёнка онлайн пока нельзя — оплатите его в клубе',
            })
        }
        return startProviderPayment(
            { prisma: this.prisma, gateway: this.gateway, logger: this.logger },
            {
                settings,
                workspaceId: f.workspaceId,
                userId: f.userId,
                planId: plan.id,
                eventRegistrationId: null,
                planName: plan.name,
                amount: plan.price,
                currency: plan.currency,
                description: `Абонемент «${plan.name}» — ${workspace.name}`,
                itemName: `Абонемент «${plan.name}»`,
                customerEmail: user.email,
            },
        )
    }
}
