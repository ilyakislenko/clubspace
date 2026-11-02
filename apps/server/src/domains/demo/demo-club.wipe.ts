import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { DEMO_ACCOUNT_EMAILS, type DemoClubIdentity } from './demo-clubs'

// Removes one demo club. Only ever called with the id of the club holding the
// demo key AND flagged isDemo (DemoClubService checks both first).
//
// The workspace row cascades to almost everything; what it cannot reach goes
// first: rows pointing at the club or its plans/levels/tags with Restrict
// (subscriptions, journal, favourites, promotions and grading candidates, video
// tags) and the club's audit trail (no foreign key at all).
export const wipeDemoWorkspace = async (
    tx: PrismaTransactionClientType,
    workspaceId: string,
): Promise<void> => {
    const byClub = { where: { workspaceId } }
    await tx.attendanceRecord.deleteMany(byClub)
    await tx.subscriptionFreezeRequest.deleteMany(byClub)
    await tx.subscriptionFreeze.deleteMany(byClub)
    await tx.payment.deleteMany(byClub)
    await tx.subscription.deleteMany(byClub)
    await tx.rankGradingCandidate.deleteMany(byClub)
    await tx.rankPromotion.deleteMany(byClub)
    await tx.videoFavorite.deleteMany(byClub)
    await tx.videoTag.deleteMany({ where: { video: { workspaceId } } })
    await tx.trainingJournalEntry.deleteMany(byClub)
    await tx.auditEvent.deleteMany(byClub)
    await tx.workspace.delete({ where: { id: workspaceId } })
}

// Generated people go with their club. A generated account that has since
// become a member or the owner of a real club is left alone (deleting it would
// reach into that club); the fixed demo accounts are kept on purpose, so the
// phones stay signed in across resets — only their consent evidence and
// family links are rebuilt by the generator, and only for the club being
// reset. People of the other demo club are never touched: whoever still has
// an abonement or a visit (those who left it), or is the parent of someone
// who is still a member somewhere, stays.
export const deleteDemoOnlyUsers = async (
    tx: PrismaTransactionClientType,
    club: DemoClubIdentity,
): Promise<number> => {
    const candidates = await tx.user.findMany({
        where: {
            isDemo: true,
            OR: [{ email: null }, { email: { notIn: [...DEMO_ACCOUNT_EMAILS] } }],
            workspaceMemberships: { none: {} },
            subscriptions: { none: {} },
            attendanceRecords: { none: {} },
            guardianOf: { none: { dependent: { workspaceMemberships: { some: {} } } } },
        },
        select: { id: true },
    })
    const ids = candidates.map((c) => c.id)
    const owners = new Set(
        (
            await tx.workspace.findMany({
                where: { ownerId: { in: ids } },
                select: { ownerId: true },
            })
        ).map((w) => w.ownerId),
    )
    const { count } = await tx.user.deleteMany({
        where: { id: { in: ids.filter((id) => !owners.has(id)) } },
    })

    const accounts = await tx.user.findMany({
        where: { isDemo: true, email: { in: club.accounts.map((a) => a.email) } },
        select: { id: true },
    })
    const accountIds = accounts.map((a) => a.id)
    await tx.consentRecord.deleteMany({ where: { userId: { in: accountIds } } })
    await tx.guardianship.deleteMany({ where: { guardianId: { in: accountIds } } })
    return count
}
