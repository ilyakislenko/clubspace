import { syncLastAttendedAt } from '../../features/attendance/last-attended'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import type { SubscriptionFreezeService } from '../subscriptions/services/subscription-freeze.service'
import { generateJoinCode } from '../workspace/join-code'
import type { DemoClubPlan } from './demo-club.plan'

// Keeps every INSERT well under Postgres' 65 535 bind parameters.
const CHUNK = 1000

const inChunks = async <T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
        await insert(rows.slice(i, i + CHUNK))
    }
}

// Inserts a generated plan inside the caller's transaction, parents before
// children. Freezes go through SubscriptionFreezeService so the end date and
// access window move exactly as when a club freezes an abonement, and
// lastAttendedAt is recomputed the way the attendance handlers do.
export const writeDemoClubPlan = async (
    tx: PrismaTransactionClientType,
    plan: DemoClubPlan,
    deps: { freezes: SubscriptionFreezeService; now: Date },
): Promise<void> => {
    const roles = await tx.role.findMany({
        where: { name: { in: ['admin', 'head_coach', 'coach', 'user'] } },
        select: { id: true, name: true },
    })
    const roleId = new Map(roles.map((r) => [r.name, r.id]))
    if (roleId.size < 4) {
        throw new BadRequestError({
            message: 'Роли не созданы — запустите сервер хотя бы раз перед генерацией демо',
        })
    }

    const emails = plan.users.flatMap((u) => (u.email ? [u.email] : []))
    const taken = await tx.user.findMany({
        where: { email: { in: emails }, isDemo: false },
        select: { email: true },
    })
    if (taken.length > 0) {
        throw new BadRequestError({
            message: `Адрес ${taken[0].email} занят настоящим аккаунтом — демо его не тронет`,
        })
    }

    // Placeholder phones are unique like any phone: one a real account (or a
    // demo person outside this plan) already holds stays with them, and the
    // demo person goes without.
    const phones = plan.users.flatMap((u) => (u.phone ? [u.phone] : []))
    const heldPhones = new Set(
        (
            await tx.user.findMany({
                where: {
                    phone: { in: phones },
                    id: { notIn: plan.users.map((u) => u.id as string) },
                },
                select: { phone: true },
            })
        ).map((u) => u.phone),
    )
    const users = plan.users.map((u) => (u.phone && heldPhones.has(u.phone) ? { ...u, phone: null } : u))

    // The fixed accounts survive a reset (skipDuplicates); refresh their
    // profile so a renamed or edited demo account comes back as scripted.
    await inChunks(users, (data) => tx.user.createMany({ data, skipDuplicates: true }))
    const accountIds = new Set(Object.values(plan.accountUserIds))
    for (const u of users.filter((x) => accountIds.has(x.id as string))) {
        await tx.user.update({
            where: { id: u.id as string },
            data: {
                firstname: u.firstname,
                lastname: u.lastname,
                description: u.description,
                dateOfBirth: u.dateOfBirth,
                phone: u.phone,
                status: 'ACTIVE',
                isDemo: true,
                personalDataConsentVersion: u.personalDataConsentVersion,
            },
        })
    }
    await tx.consentRecord.createMany({ data: plan.consents })

    await tx.workspace.create({ data: plan.workspace })
    await tx.guardianship.createMany({ data: plan.guardianships })
    await tx.workspaceBilling.create({ data: plan.billing })
    await tx.workspaceModuleEntitlement.createMany({ data: plan.moduleEntitlements })
    await tx.clubLegalAcceptance.create({ data: plan.legalAcceptance })
    const codeOwner = await tx.workspaceJoinCode.findUnique({
        where: { code: plan.joinCode },
        select: { workspaceId: true },
    })
    await tx.workspaceJoinCode.create({
        data: {
            workspaceId: plan.workspaceId,
            code: codeOwner ? generateJoinCode() : plan.joinCode,
        },
    })

    await tx.gym.createMany({ data: plan.gyms })
    await tx.direction.createMany({ data: plan.directions })
    await tx.directionManager.createMany({ data: plan.directionManagers })
    await tx.plan.createMany({ data: plan.plans })
    await tx.planDirection.createMany({ data: plan.planDirections })
    await inChunks(plan.members, (chunk) =>
        tx.workspaceMember.createMany({
            data: chunk.map((m) => ({ ...m.data, roleId: roleId.get(m.role) as string })),
        }),
    )
    await tx.group.createMany({ data: plan.groups })
    await tx.groupCoach.createMany({ data: plan.groupCoaches })
    await tx.groupScheduleSlot.createMany({ data: plan.slots })
    await tx.scheduleException.createMany({ data: plan.scheduleExceptions })
    await inChunks(plan.groupMembers, (data) => tx.groupMember.createMany({ data }))

    await tx.rankLadder.createMany({ data: plan.ladders })
    await tx.rankLevel.createMany({ data: plan.levels })
    await inChunks(plan.promotions, (data) => tx.rankPromotion.createMany({ data }))
    await tx.rankGrading.createMany({ data: plan.gradings })
    await tx.rankGradingCandidate.createMany({ data: plan.gradingCandidates })

    await tx.workspaceEvent.createMany({ data: plan.events })
    await tx.eventRegistration.createMany({ data: plan.eventRegistrations })
    await inChunks(plan.subscriptions, (data) => tx.subscription.createMany({ data }))
    await inChunks(plan.subscriptionDirections, (data) =>
        tx.subscriptionDirection.createMany({ data }),
    )
    await inChunks(plan.sessions, (data) => tx.attendanceSession.createMany({ data }))
    await inChunks(plan.records, (data) => tx.attendanceRecord.createMany({ data }))
    // After the slots, users and subscriptions (a burn points at its pack).
    await tx.classOccurrence.createMany({ data: plan.classOccurrences })
    await tx.classBooking.createMany({ data: plan.classBookings })
    await tx.subscriptionFreezeRequest.createMany({ data: plan.freezeRequests })

    await tx.announcement.createMany({ data: plan.announcements })
    await tx.announcementGroup.createMany({ data: plan.announcementGroups })
    await tx.achievement.createMany({ data: plan.achievements })
    await tx.video.createMany({ data: plan.videos })
    await tx.course.createMany({ data: plan.courses })
    await tx.chapter.createMany({ data: plan.chapters })
    await tx.courseVideo.createMany({ data: plan.courseVideos })
    await tx.courseAudience.createMany({ data: plan.courseAudiences })

    await tx.personalTrainingCoach.createMany({ data: plan.ptCoaches })
    await tx.personalTrainingRequest.createMany({ data: plan.ptRequests })
    await tx.personalTrainingOption.createMany({ data: plan.ptOptions })
    await tx.dropInBooking.createMany({ data: plan.dropIns })
    await tx.classSubstitution.createMany({ data: plan.classSubstitutions })
    await tx.memberRetentionContact.createMany({ data: plan.retentionContacts })
    await tx.trainingJournalEntry.createMany({ data: plan.journal })
    await tx.auditEvent.createMany({ data: plan.auditEvents })
    await tx.aiAccessToken.createMany({ data: plan.aiTokens })
    await tx.aiDataTransferAcceptance.createMany({ data: plan.aiChatAcceptances })
    await tx.aiChatConversation.createMany({ data: plan.aiChatConversations })
    await tx.aiChatUsage.createMany({ data: plan.aiChatUsages })

    for (const f of plan.liveFreezes) {
        await deps.freezes.createInTx(tx, {
            workspaceId: plan.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
            days: f.days,
            reason: f.reason,
            now: deps.now,
        })
    }

    await syncLastAttendedAt(
        tx,
        plan.workspaceId,
        plan.members.map((m) => m.data.userId),
    )
}
