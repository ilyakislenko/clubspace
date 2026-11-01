import { Injectable } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    type ClubLegalAcceptance,
    type ClubLegalAcceptanceSource,
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    LegalAcceptanceRequiredError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { AuditService } from '../../audit/services/audit.service'
import {
    clubLegalStatus,
    type ClubLegalStatus,
    LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
    type LegalVersions,
} from '../club-legal'

// Column widths of ClubLegalAcceptance.ip / userAgent / userName.
const IP_MAX = 64
const USER_AGENT_MAX = 512
const NAME_MAX = 255

export type ClubLegalState = {
    current: LegalVersions
    ownerId: string
    latest: ClubLegalAcceptance | null
    status: ClubLegalStatus
}

// A club's acceptance of the platform's offer and DPA (domains/billing/
// club-legal.ts): the evidence rows, where the club stands with the current
// editions, and the gate on its paid actions.
@Injectable()
export class ClubLegalService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    current(): LegalVersions {
        const { offerVersion, dpaVersion } = environment.billing.legal
        return { offerVersion, dpaVersion }
    }

    async getState(workspaceId: string, now: Date = new Date()): Promise<ClubLegalState> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true, createdAt: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const latest = await this.prisma.clubLegalAcceptance.findFirst({
            where: { workspaceId },
            orderBy: { acceptedAt: 'desc' },
        })
        const current = this.current()
        return {
            current,
            ownerId: workspace.ownerId,
            latest,
            status: clubLegalStatus({
                current,
                accepted: latest,
                clubCreatedAt: workspace.createdAt,
                graceDays: environment.billing.legal.acceptGraceDays,
                now,
            }),
        }
    }

    // Records that the club owner (userId) accepted the current editions.
    // Evidence only — the caller decides who may accept.
    async record(
        p: {
            workspaceId: string
            userId: string
            source: ClubLegalAcceptanceSource
            ip?: string | null
            userAgent?: string | null
            recordedById?: string | null
            paymentId?: string | null
            now?: Date
        },
        tx?: PrismaTransactionClientType,
    ): Promise<ClubLegalAcceptance> {
        const db = tx ?? this.prisma
        const user = await db.user.findUnique({
            where: { id: p.userId },
            select: { email: true, firstname: true, lastname: true },
        })
        const name = [user?.firstname, user?.lastname].filter(Boolean).join(' ')
        return db.clubLegalAcceptance.create({
            data: {
                workspaceId: p.workspaceId,
                userId: p.userId,
                userEmail: user?.email ?? null,
                userName: name ? name.slice(0, NAME_MAX) : null,
                ...this.current(),
                source: p.source,
                ip: p.ip ? p.ip.slice(0, IP_MAX) : null,
                userAgent: p.userAgent ? p.userAgent.slice(0, USER_AGENT_MAX) : null,
                recordedById: p.recordedById ?? null,
                paymentId: p.paymentId ?? null,
                ...(p.now ? { acceptedAt: p.now } : {}),
            },
        })
    }

    // record() outside a transaction, journaled (the club's and the
    // console's audit feed).
    async accept(p: {
        workspaceId: string
        userId: string
        source: ClubLegalAcceptanceSource
        ip?: string | null
        userAgent?: string | null
        paymentId?: string | null
    }): Promise<ClubLegalAcceptance> {
        const row = await this.record(p)
        await this.audit.record({
            action: 'workspace.legalAccept',
            targetType: 'workspace',
            targetId: p.workspaceId,
            workspaceId: p.workspaceId,
            actorId: p.userId,
            metadata: {
                source: row.source,
                offerVersion: row.offerVersion,
                dpaVersion: row.dpaVersion,
                paymentId: row.paymentId,
            },
        })
        return row
    }

    // The owner's first card payment (the checkout, or binding the card that
    // pays the first period when the trial ends) accepts the current
    // editions — the offer names payment as acceptance. Only the owner
    // accepts for the club, and only until the club has paid a period; a
    // repeated tap that reuses the same payment records nothing new.
    async acceptByFirstPayment(p: {
        workspaceId: string
        userId: string
        paymentId: string
        ip: string | null
        userAgent: string | null
    }): Promise<ClubLegalAcceptance | null> {
        const [workspace, billing, existing] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: p.workspaceId },
                select: { ownerId: true },
            }),
            this.prisma.workspaceBilling.findUnique({
                where: { workspaceId: p.workspaceId },
                select: { convertedAt: true },
            }),
            this.prisma.clubLegalAcceptance.findFirst({
                where: { workspaceId: p.workspaceId, paymentId: p.paymentId },
                select: { id: true },
            }),
        ])
        if (workspace?.ownerId !== p.userId || billing?.convertedAt || existing) {
            return null
        }
        return this.accept({ ...p, source: 'PAYMENT' })
    }

    // Paying, binding a card or connecting a module: refused once the grace
    // for accepting the current editions is over. A self-hosted install
    // (billing off) sells nothing, so nothing is gated.
    async assertPaidActionsAllowed(workspaceId: string, now: Date = new Date()): Promise<void> {
        if (!environment.billing.enabled) return
        const { status } = await this.getState(workspaceId, now)
        if (status.required) {
            throw new LegalAcceptanceRequiredError({
                message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
            })
        }
    }
}
