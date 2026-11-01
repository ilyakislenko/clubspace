import { exit } from 'process'

import { AuditService } from './domains/audit/services/audit.service'
import { DemoClubService } from './domains/demo/demo-club.service'
import { SubscriptionFreezeService } from './domains/subscriptions/services/subscription-freeze.service'
import { environment } from './environments/environment'
import { PrismaService } from './infrastructure/prisma'
import { resolveDemoMode } from './shared/utils/demo-mode.util'

// `npm run demo:reset` — the console's «Сбросить демо» from a terminal (the
// Mac before a meeting, docs/demo.md). Same service, same guards: DEMO_MODE
// must be on and name the demo club, and only that club and its generated
// people are rebuilt. Needs the database the server uses (.env); the server
// must have booted once (roles). Phones refetch on their own within a minute
// (the leaderboard cache lives 60 s); pull to refresh to see it at once.
async function main() {
    resolveDemoMode(environment.demo)
    const prisma = new PrismaService({ url: environment.databaseUrl, poolMax: 4 })
    try {
        await prisma.$connect()
        const demo = new DemoClubService(
            prisma,
            new SubscriptionFreezeService(prisma),
            new AuditService(prisma),
        )
        const result = await demo.reset({ actorId: null })
        console.log(
            `Демо-клуб пересоздан за ${(result.durationMs / 1000).toFixed(1)} с: ` +
                `${result.counts.members} участников, ${result.counts.groups} групп, ` +
                `${result.counts.sessions} занятий, ${result.counts.visits} посещений, ` +
                `${result.counts.subscriptions} абонементов`,
        )
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
