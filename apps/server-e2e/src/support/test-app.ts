import { MailerService } from '@nestjs-modules/mailer'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ThrottlerStorage } from '@nestjs/throttler'
// Default import, not `import * as`: supertest's export is the callable itself,
// and under swc's commonjs output a namespace import hands back the module
// object rather than the function.
import request from 'supertest'

import { AppModule } from '../../../server/src/app/app.module'
import { BootstrapSeedService } from '../../../server/src/app/bootstrap-seed.service'
import { SchedulerTickProcessor } from '../../../server/src/domains/scheduler/scheduler-tick.processor'
import { PrismaService } from '../../../server/src/infrastructure/prisma'

// A captured outgoing email. The suite reads OTP codes out of these instead of
// stubbing the auth handler, so a spec that signs a user in has proved the
// whole chain: code issued → event published → notification feature → template
// rendered → mail handed to the transport. That chain broke once already and
// surfaced only as a log line after a human failed to log in.
export type SentMail = {
    to: string
    subject: string
    html: string
}

/**
 * Six-digit runs in the email body that could be the OTP.
 *
 * Excludes anything glued to a `#` (CSS hex colours — the code template's own
 * span used to be `color:#204087`) or sitting inside a longer word/number.
 */
export const findOtpCodes = (html: string): string[] =>
    // De-duplicated: the subject ("Код для входа: 123456") is also rendered
    // into the document's <title>, so the same code legitimately appears twice.
    Array.from(
        new Set(
            Array.from(
                html.matchAll(/(?<![#\w\d])(\d{6})(?![\w\d])/g),
                (m) => m[1],
            ),
        ),
    )

export class MailBox {
    readonly sent: SentMail[] = []

    /**
     * What verifyAllTransporters reports. Flip it to false to simulate a
     * misconfigured or unreachable SMTP host without stopping a container.
     *
     * Note it returns false rather than throwing — that is the real
     * nodemailer contract, and a readiness check that only caught a thrown
     * error reported a dead mail server as healthy.
     */
    transportHealthy = true

    clear() {
        this.sent.length = 0
        this.transportHealthy = true
    }

    /** Emails are sent from a fire-and-forget event listener, so the POST that
     *  triggers one returns before the mail exists. Poll rather than sleep. */
    async waitFor(
        predicate: (mail: SentMail) => boolean,
        timeoutMs = 5000,
    ): Promise<SentMail> {
        const deadline = Date.now() + timeoutMs
        for (;;) {
            const found = this.sent.find(predicate)
            if (found) return found
            if (Date.now() > deadline) {
                throw new Error(
                    `No matching email within ${timeoutMs}ms. Captured ` +
                        `${this.sent.length}: ` +
                        JSON.stringify(
                            this.sent.map((m) => ({
                                to: m.to,
                                subject: m.subject,
                            })),
                        ),
                )
            }
            await new Promise((resolve) => setTimeout(resolve, 25))
        }
    }

    async waitForCodeTo(email: string, timeoutMs = 5000): Promise<string> {
        const mail = await this.waitFor(
            (m) => m.to === email && findOtpCodes(m.html).length > 0,
            timeoutMs,
        )
        const codes = findOtpCodes(mail.html)
        // Exactly one, or refuse to guess. The first version of this helper
        // took the first 6-digit run in the document and happily returned
        // 204087 — the hex colour on the code's own <span>. Every sign-in
        // failed with "Неверный код" and the template looked innocent.
        if (codes.length !== 1) {
            throw new Error(
                `Expected exactly one 6-digit code in the email to ${email}, ` +
                    `found ${codes.length}: ${codes.join(', ')}. If the ` +
                    `template gained another number, teach findOtpCodes about ` +
                    `it rather than picking one at random.`,
            )
        }
        return codes[0]
    }
}

export type TestApp = {
    app: INestApplication
    prisma: PrismaService
    mail: MailBox
    /** supertest agent bound to the in-process server. */
    http: () => request.Agent
    seed: BootstrapSeedService
    close: () => Promise<void>
}

export type TestAppOptions = {
    /**
     * Leave the real ThrottlerGuard in place. Off by default.
     *
     * The limits are per client IP and every request in the suite arrives from
     * the same loopback address, so with it on the eighth spec in a file
     * starts returning 429 and the failure moves as tests are reordered — a
     * suite that fails for reasons unrelated to what it asserts. Rate limiting
     * is real behaviour and is covered on its own in throttling.e2e-spec.ts,
     * which boots an app with this switched on.
     */
    rateLimiting?: boolean
}

/**
 * Boots the real AppModule against the real test database.
 *
 * Only two things are replaced, and only because they reach outside the
 * machine: the mail transport (captured so specs can read codes) and nothing
 * else. Guards, the Zod validation pipe, the serializer interceptor and the
 * global error filter are all the production ones — which is the point. A
 * controller unit test passed while /readyz returned the right status with the
 * wrong body, because the global filter rewrote it; only a test that goes
 * through the real filter can see that.
 */
export const createTestApp = async (
    options: TestAppOptions = {},
): Promise<TestApp> => {
    const mail = new MailBox()

    let builder = Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(MailerService)
        .useValue({
            sendMail: async (opts: {
                to: string
                subject: string
                html: string
            }) => {
                mail.sent.push({
                    to: opts.to,
                    subject: opts.subject,
                    html: opts.html ?? '',
                })
                return { messageId: `e2e-${mail.sent.length}` }
            },
            verifyAllTransporters: async () => mail.transportHealthy,
        })

    // The scheduler is a repeatable BullMQ job that fires every 60 seconds and
    // fans out reminders, announcements and access-expiry notices — writing to
    // the same database the assertions read, and pushing mail into the same
    // MailBox they inspect. A ~30s suite therefore had a tick land inside it
    // roughly every other run, which is what an intermittently failing sign-in
    // spec turned out to be. Background work under a test suite is
    // nondeterminism by construction.
    //
    // Overriding the provider means no @Processor worker is created, so the
    // delayed entries BullMQ has already persisted are never executed either.
    builder = builder.overrideProvider(SchedulerTickProcessor).useValue({
        onModuleInit: async () => undefined,
        process: async () => undefined,
    })

    if (!options.rateLimiting) {
        // Swap the counter store, not the guard. ThrottlerGuard, the @Throttle
        // decorators and the whole request path still run for real — the
        // counter simply never reaches its limit. Two things that did not work:
        // clearing the real storage between tests (it schedules cleanup timers
        // and reading a key we deleted throws "Cannot destructure property
        // 'totalHits' of undefined" in an unrelated spec), and overriding
        // APP_GUARD (Nest treats it as a multi-provider and kept the original).
        builder = builder.overrideProvider(ThrottlerStorage).useValue({
            increment: async () => ({
                totalHits: 1,
                timeToExpire: 60,
                isBlocked: false,
                timeToBlockExpire: 0,
            }),
        })
    }

    const moduleRef = await builder.compile()

    const app = moduleRef.createNestApplication()

    // Nothing is registered by hand here. The validation pipe, the Zod
    // serializer, the throttler guard and the error filter are all APP_*
    // providers inside AppModule, so importing the module brings the real ones
    // along — registering them again would double-apply them and stop the
    // suite from resembling production. The only globals main.ts adds on top
    // are CORS, `trust proxy` (rate-limit bucketing) and the Scalar docs page,
    // none of which change handler behaviour.
    await app.init()

    const prisma = app.get(PrismaService)
    const seed = app.get(BootstrapSeedService)

    return {
        app,
        prisma,
        mail,
        http: () => request(app.getHttpServer()),
        seed,
        close: async () => {
            await app.close()
        },
    }
}

// Tables the seed owns. Truncating them and re-seeding on every test would
// cost more than it buys — they're reference data (roles, email templates, TFA
// config) that no spec mutates.
const SEED_OWNED_TABLES = new Set(['Role', 'EmailTemplate', 'Tfa', '_prisma_migrations'])

/**
 * Empties every table a test could have written to, so specs can assume an
 * empty world without depending on execution order. CASCADE handles the FK
 * graph; RESTART IDENTITY resets sequences so autoincrement ids don't drift
 * across a run.
 *
 * Deliberately does NOT wait for background work to settle first. That was
 * tried: the email listener writes a delivery result after the request has
 * answered, and truncating mid-flight used to blow up with P2025. The fix
 * belongs in the listener, not here — updateNotificationStatus now uses
 * updateMany, so recording the outcome of a notification that no longer exists
 * is a no-op. A wait here would also have to guess which pending rows are
 * genuinely in flight, and rows can legitimately sit without a delivery result
 * forever (a notification whose send was skipped), so the guess is wrong.
 */
export const resetDatabase = async (prisma: PrismaService) => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `
    const targets = rows
        .map((r) => r.tablename)
        .filter((name) => !SEED_OWNED_TABLES.has(name))
        .map((name) => `"public"."${name}"`)

    if (targets.length === 0) return
    await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${targets.join(', ')} RESTART IDENTITY CASCADE`,
    )
}
