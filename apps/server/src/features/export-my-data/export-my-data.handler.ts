import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    afterCursor,
    collectPages,
    isoDate,
    isoOrNull,
} from './export-my-data-utils'
import {
    ExportMyDataFeature,
    ExportMyDataFeatureResponse,
} from './export-my-data.feature'

const CLUB = { select: { id: true, name: true } } as const

// Self-service copy of everything the platform keeps about the caller
// (152-ФЗ ст. 14, GDPR art. 15/20), across every club they belong to. Only
// the caller's own rows; staff-internal notes about them are not included.
@Feature(ExportMyDataFeature)
export class ExportMyDataHandler
    implements IFeatureHandler<ExportMyDataFeature, ExportMyDataFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        userId,
    }: ExportMyDataFeature): Promise<ExportMyDataFeatureResponse> {
        const profile = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                phone: true,
                firstname: true,
                lastname: true,
                dateOfBirth: true,
                description: true,
                profilePhotoUrl: true,
                language: true,
                createdAt: true,
                lastSeenAt: true,
            },
        })
        if (!profile) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }

        const [
            consents,
            memberships,
            attendance,
            subscriptions,
            payments,
            freezes,
            journal,
            ranks,
        ] = await Promise.all([
            collectPages((cursor, take) =>
                this.prisma.consentRecord.findMany({
                    where: { userId },
                    orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        kind: true,
                        version: true,
                        acceptedAt: true,
                        ip: true,
                        userAgent: true,
                        withdrawnAt: true,
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.workspaceMember.findMany({
                    where: { userId },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        status: true,
                        accessUntil: true,
                        createdAt: true,
                        workspace: CLUB,
                        role: { select: { name: true } },
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.attendanceRecord.findMany({
                    where: { userId },
                    orderBy: [{ markedAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        markedAt: true,
                        isGuest: true,
                        workspace: CLUB,
                        session: { select: { title: true, startAt: true } },
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.subscription.findMany({
                    // Kept abonements of clubs they have left are theirs too.
                    where: { OR: [{ userId }, { workspaceMember: { userId } }] },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        status: true,
                        startDate: true,
                        endDate: true,
                        classesTotal: true,
                        classesRemaining: true,
                        amountPaid: true,
                        currency: true,
                        isPaid: true,
                        paidAt: true,
                        createdAt: true,
                        workspace: CLUB,
                        plan: { select: { name: true } },
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.payment.findMany({
                    where: { userId },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        planName: true,
                        provider: true,
                        status: true,
                        amount: true,
                        currency: true,
                        createdAt: true,
                        paidAt: true,
                        refundedAt: true,
                        workspace: CLUB,
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.subscriptionFreeze.findMany({
                    where: { userId },
                    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        fromDate: true,
                        untilDate: true,
                        reason: true,
                        endedEarlyAt: true,
                        workspace: CLUB,
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.trainingJournalEntry.findMany({
                    where: { userId },
                    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        entryDate: true,
                        body: true,
                        createdAt: true,
                        workspace: CLUB,
                    },
                }),
            ),
            collectPages((cursor, take) =>
                this.prisma.rankPromotion.findMany({
                    where: { userId },
                    orderBy: [{ awardedAt: 'asc' }, { id: 'asc' }],
                    take,
                    ...afterCursor(cursor),
                    select: {
                        id: true,
                        stripes: true,
                        note: true,
                        awardedAt: true,
                        workspace: CLUB,
                        ladder: { select: { name: true } },
                        level: { select: { name: true } },
                    },
                }),
            ),
        ])

        const sections = {
            consents,
            memberships,
            attendance,
            subscriptions,
            payments,
            freezes,
            journal,
            ranks,
        }
        const truncated = Object.entries(sections)
            .filter(([, section]) => section.truncated)
            .map(([name]) => name)

        await this.audit.record({
            action: 'me.export',
            targetType: 'member',
            targetId: userId,
            actorId: userId,
            workspaceId: null,
            metadata: Object.fromEntries(
                Object.entries(sections).map(([name, section]) => [
                    name,
                    section.rows.length,
                ]),
            ),
        })

        return {
            formatVersion: 1,
            generatedAt: new Date().toISOString(),
            profile: {
                id: profile.id,
                email: profile.email,
                phone: profile.phone,
                firstname: profile.firstname,
                lastname: profile.lastname,
                dateOfBirth: profile.dateOfBirth
                    ? isoDate(profile.dateOfBirth)
                    : null,
                description: profile.description,
                profilePhotoUrl: profile.profilePhotoUrl,
                language: profile.language,
                createdAt: profile.createdAt.toISOString(),
                lastSeenAt: profile.lastSeenAt.toISOString(),
            },
            consents: consents.rows.map((c) => ({
                kind: c.kind,
                version: c.version,
                acceptedAt: c.acceptedAt.toISOString(),
                ip: c.ip,
                userAgent: c.userAgent,
                withdrawnAt: isoOrNull(c.withdrawnAt),
            })),
            memberships: memberships.rows.map((m) => ({
                club: m.workspace,
                role: m.role.name,
                status: m.status,
                joinedAt: m.createdAt.toISOString(),
                accessUntil: isoOrNull(m.accessUntil),
            })),
            attendance: attendance.rows.map((a) => ({
                club: a.workspace,
                title: a.session.title,
                startAt: a.session.startAt.toISOString(),
                markedAt: a.markedAt.toISOString(),
                isGuest: a.isGuest === true,
            })),
            subscriptions: subscriptions.rows.map((s) => ({
                club: s.workspace,
                plan: s.plan.name,
                status: s.status,
                startDate: isoOrNull(s.startDate),
                endDate: isoOrNull(s.endDate),
                classesTotal: s.classesTotal,
                classesRemaining: s.classesRemaining,
                amountPaid: s.amountPaid,
                currency: s.currency,
                isPaid: s.isPaid,
                paidAt: isoOrNull(s.paidAt),
                createdAt: s.createdAt.toISOString(),
            })),
            payments: payments.rows.map((p) => ({
                club: p.workspace,
                plan: p.planName,
                provider: p.provider,
                status: p.status,
                amount: p.amount,
                currency: p.currency,
                createdAt: p.createdAt.toISOString(),
                paidAt: isoOrNull(p.paidAt),
                refundedAt: isoOrNull(p.refundedAt),
            })),
            freezes: freezes.rows.map((f) => ({
                club: f.workspace,
                fromDate: isoDate(f.fromDate),
                untilDate: isoDate(f.untilDate),
                reason: f.reason,
                endedEarlyAt: isoOrNull(f.endedEarlyAt),
            })),
            journal: journal.rows.map((j) => ({
                club: j.workspace,
                entryDate: isoDate(j.entryDate),
                body: j.body,
                createdAt: j.createdAt.toISOString(),
            })),
            ranks: ranks.rows.map((r) => ({
                club: r.workspace,
                ladder: r.ladder.name,
                level: r.level.name,
                stripes: r.stripes,
                note: r.note,
                awardedAt: r.awardedAt.toISOString(),
            })),
            truncated,
        }
    }
}
