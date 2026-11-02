import { argv, exit } from 'process'

import { AnalyticsSnapshotService } from './domains/analytics/analytics-snapshot.service'
import { AuditService } from './domains/audit/services/audit.service'
import { DEMO_CLUB_IDS, DEMO_CLUBS, type DemoClubId, isDemoClubId } from './domains/demo/demo-clubs'
import { DemoClubService } from './domains/demo/demo-club.service'
import { SubscriptionFreezeService } from './domains/subscriptions/services/subscription-freeze.service'
import { environment } from './environments/environment'
import { PrismaService } from './infrastructure/prisma'
import { resolveDemoMode } from './shared/utils/demo-mode.util'

// `npm run demo:reset [-- academy|ritm|all]` — the console's «Сбросить демо»
// from a terminal (the Mac before a meeting, docs/demo.md). ACADEMY when no
// club is named. Same service, same guards: DEMO_MODE must be on and name the
// demo club, and only the named demo club and its generated people are
// rebuilt. Needs the database the server uses (.env); the server must have
// booted once (roles). Phones refetch on their own within a minute (the
// leaderboard cache lives 60 s); pull to refresh to see it at once.
const clubsToReset = (arg: string | undefined): readonly DemoClubId[] => {
    if (arg === undefined) return ['academy']
    if (arg === 'all') return DEMO_CLUB_IDS
    if (isDemoClubId(arg)) return [arg]
    throw new Error(`неизвестный демо-клуб «${arg}» — ${DEMO_CLUB_IDS.join(', ')} или all`)
}

async function main() {
    resolveDemoMode(environment.demo)
    const clubs = clubsToReset(argv[2])
    const prisma = new PrismaService({ url: environment.databaseUrl, poolMax: 4 })
    try {
        await prisma.$connect()
        const demo = new DemoClubService(
            prisma,
            new SubscriptionFreezeService(prisma),
            new AuditService(prisma),
            new AnalyticsSnapshotService(prisma),
        )
        for (const club of clubs) {
            const result = await demo.reset({ club, actorId: null })
            console.log(
                `${DEMO_CLUBS[club].name} пересоздан за ${(result.durationMs / 1000).toFixed(1)} с: ` +
                    `${result.counts.members} участников, ${result.counts.groups} групп, ` +
                    `${result.counts.sessions} занятий, ${result.counts.visits} посещений, ` +
                    `${result.counts.subscriptions} абонементов`,
            )
        }
    } finally {
        await prisma.$disconnect()
    }
}

main().then(
    () => exit(0),
    (error: unknown) => {
        console.error(
            `Сброс демо не выполнен: ${error instanceof Error ? error.message : String(error)}`,
        )
        exit(1)
    },
)
