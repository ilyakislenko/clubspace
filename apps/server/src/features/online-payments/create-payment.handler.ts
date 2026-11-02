import { randomUUID } from 'crypto'

import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isWorkspaceEntitled } from '../../domains/billing/module-entitlement'
import {
    onlineGrantStart,
    sameScopeAbonements,
} from '../../domains/payments/online-grant-start'
import { toGatewayCredentials } from '../../domains/payments/payment-credentials'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { scopeDirectionIds } from '../../domains/subscriptions/current-subscriptions'
import { environment } from '../../environments/environment'
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

const PROVIDER_FAILED =
    'Не удалось создать платёж. Попробуйте позже или обратитесь в клуб'

// The member buys a tariff online: a PENDING Payment row first (its id goes to
// the provider as metadata and into the return URL), then the provider's
// payment with an Idempotence-Key, then the confirmation URL the app opens.
// The abonement is created only by the webhook, never here.
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
        if (!environment.appUrl) {
            this.logger.error('APP_URL is not set: no return URL for payments')
            throw new BadRequestError({ message: PROVIDER_FAILED })
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
        const payment = await this.prisma.payment.create({
            data: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                planId: plan.id,
                planName: plan.name,
                provider: settings.provider,
                amount: plan.price,
                currency: plan.currency,
                idempotenceKey: randomUUID(),
            },
        })

        let confirmationUrl: string | null = null
        let providerPaymentId: string | null = null
        try {
            const created = await this.gateway.createPayment(
                toGatewayCredentials(settings, environment.encryptionKey),
                {
                    paymentId: payment.id,
                    workspaceId: f.workspaceId,
                    idempotenceKey: payment.idempotenceKey,
                    amount: payment.amount,
                    currency: payment.currency,
                    description: `Абонемент «${plan.name}» — ${workspace.name}`,
                    itemName: `Абонемент «${plan.name}»`,
                    returnUrl: `${environment.appUrl.replace(/\/+$/, '')}/payment/${payment.id}`,
                    customerEmail: user.email,
                },
            )
            confirmationUrl = created.confirmationUrl
            providerPaymentId = created.providerPaymentId
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(
                `Payment ${payment.id} not created at ${settings.provider}: ${err.message}${
                    err.providerMessage ? ` (${err.providerMessage})` : ''
                }`,
            )
        }
        if (!confirmationUrl || !providerPaymentId) {
            await this.prisma.payment.update({
                where: { id: payment.id },
                data: { status: 'CANCELED', providerPaymentId },
            })
            throw new BadRequestError({ message: PROVIDER_FAILED })
        }

        const saved = await this.prisma.payment.update({
            where: { id: payment.id },
            data: { providerPaymentId, confirmationUrl },
        })
        return { payment: serializeMyPayment(saved), confirmationUrl }
    }
}
