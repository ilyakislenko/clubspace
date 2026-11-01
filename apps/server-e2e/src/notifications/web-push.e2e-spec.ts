import { createDecipheriv, createECDH, createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

import { signIn, type Actor } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Web Push end to end: a browser subscription is stored through the API, and a
// real notification (an announcement) goes through the push queue, gets
// encrypted and VAPID-signed, and is POSTed to the subscription's endpoint — a
// local HTTP server standing in for FCM / Mozilla / Apple, which decrypts it
// with the "browser" keys exactly as a browser would.

type Received = { headers: IncomingHttpHeaders; body: Buffer }

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) =>
    createHmac('sha256', createHmac('sha256', salt).update(ikm).digest())
        .update(Buffer.concat([info, Buffer.from([1])]))
        .digest()
        .subarray(0, len)

// A browser's side of a subscription: its P-256 key pair and auth secret.
const browserKeys = () => {
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const auth = Buffer.from('0123456789abcdef')
    return {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
        decrypt: (body: Buffer) => {
            const salt = body.subarray(0, 16)
            const idlen = body[20]
            const asPublic = body.subarray(21, 21 + idlen)
            const record = body.subarray(21 + idlen)
            const ikm = hkdf(
                auth,
                ecdh.computeSecret(asPublic),
                Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]),
                32,
            )
            const decipher = createDecipheriv(
                'aes-128-gcm',
                hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
                hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12),
            )
            decipher.setAuthTag(record.subarray(record.length - 16))
            const plain = Buffer.concat([
                decipher.update(record.subarray(0, record.length - 16)),
                decipher.final(),
            ])
            return JSON.parse(plain.subarray(0, plain.length - 1).toString()) as {
                title: string
                body: string
                data: Record<string, unknown>
            }
        },
    }
}

describe('web push', () => {
    let ctx: TestApp
    let server: Server
    let base: string
    const received = new Map<string, Received[]>()
    // Status the fake push service answers per path (default 201).
    const statusFor = new Map<string, number>()

    beforeAll(async () => {
        ctx = await createTestApp()
        server = createServer((req, res) => {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
                const path = req.url ?? '/'
                const list = received.get(path) ?? []
                list.push({ headers: req.headers, body: Buffer.concat(chunks) })
                received.set(path, list)
                res.statusCode = statusFor.get(path) ?? 201
                res.end()
            })
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterAll(async () => {
        await new Promise((resolve) => server?.close(resolve))
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        received.clear()
        statusFor.clear()
    })

    const subscribe = (actor: Actor, endpoint: string, keys: { p256dh: string; auth: string }) =>
        ctx
            .http()
            .post('/me/web-push-subscriptions')
            .set(...actor.auth)
            .send({ endpoint, ...keys, userAgent: 'e2e' })

    const waitFor = async <T>(probe: () => Promise<T | undefined> | T | undefined, what: string) => {
        const deadline = Date.now() + 8000
        for (;;) {
            const value = await probe()
            if (value !== undefined) return value
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
            await sleep(50)
        }
    }

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        const ownerActor = await signIn(ctx, owner.email)
        const studentActor = await signIn(ctx, student.email)
        return { workspace, ownerActor, student, studentActor }
    }

    const announce = (workspaceId: string, actor: Actor, title: string) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/announcements`)
            .set(...actor.auth)
            .send({ title, body: 'Открытый ковёр в субботу', publish: true })
            .expect(201)

    it('hands the browser the VAPID public key', async () => {
        const { studentActor } = await setup()
        const res = await ctx
            .http()
            .get('/me/web-push-subscriptions/config')
            .set(...studentActor.auth)
            .expect(200)
        expect(res.body.publicKey).toBe(process.env.WEB_PUSH_VAPID_PUBLIC_KEY)
        await ctx.http().get('/me/web-push-subscriptions/config').expect(401)
    })

    it('stores one row per endpoint, moves it on a sign-in as someone else, and unsubscribes', async () => {
        const { student, studentActor, ownerActor } = await setup()
        const keys = browserKeys()
        await subscribe(studentActor, `${base}/s1`, { p256dh: 'bad', auth: keys.auth }).expect(400)
        await subscribe(studentActor, `${base}/s1`, keys).expect(200, { status: 'subscribed' })
        await subscribe(studentActor, `${base}/s1`, keys).expect(200)
        expect(
            await ctx.prisma.webPushSubscription.findMany({ select: { userId: true, endpoint: true } }),
        ).toEqual([{ userId: student.id, endpoint: `${base}/s1` }])

        // Another account cannot remove someone else's subscription…
        await ctx
            .http()
            .delete('/me/web-push-subscriptions')
            .set(...ownerActor.auth)
            .send({ endpoint: `${base}/s1` })
            .expect(200)
        expect(await ctx.prisma.webPushSubscription.count()).toBe(1)

        // …but the same browser signing in as them takes the row over.
        await subscribe(ownerActor, `${base}/s1`, keys).expect(200)
        const row = await ctx.prisma.webPushSubscription.findFirstOrThrow()
        expect(row.userId).not.toBe(student.id)

        await ctx
            .http()
            .delete('/me/web-push-subscriptions')
            .set(...ownerActor.auth)
            .send({ endpoint: `${base}/s1` })
            .expect(200, { status: 'removed' })
        expect(await ctx.prisma.webPushSubscription.count()).toBe(0)
    })

    it('an announcement is delivered to the subscribed browser, encrypted and VAPID-signed', async () => {
        const { workspace, ownerActor, student, studentActor } = await setup()
        const keys = browserKeys()
        await subscribe(studentActor, `${base}/student`, keys).expect(200)

        await announce(workspace.id, ownerActor, 'Сбор в субботу')

        const [push] = await waitFor(() => received.get('/student'), 'the web push')
        expect(push.headers['content-encoding']).toBe('aes128gcm')
        expect(push.headers.ttl).toBeDefined()
        expect(push.headers.authorization).toMatch(
            new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${process.env.WEB_PUSH_VAPID_PUBLIC_KEY}$`),
        )
        const message = keys.decrypt(push.body)
        expect(message.title).toContain('Сбор в субботу')
        expect(message.data).toMatchObject({
            kind: 'announcement.published',
            workspaceId: workspace.id,
            notificationId: expect.any(String),
        })

        const row = await waitFor(
            () =>
                ctx.prisma.notification
                    .findFirst({
                        where: { userId: student.id, type: 'PUSH', sent: true, error: null },
                    })
                    .then((r) => r ?? undefined),
            'the row marked delivered',
        )
        expect(row.id).toBe(message.data.notificationId)
    })

    it('drops a subscription the push service reports gone', async () => {
        const { workspace, ownerActor, student, studentActor } = await setup()
        statusFor.set('/gone', 410)
        await subscribe(studentActor, `${base}/gone`, browserKeys()).expect(200)

        await announce(workspace.id, ownerActor, 'Никто не прочитает')

        await waitFor(() => received.get('/gone'), 'the push attempt')
        await waitFor(
            async () => ((await ctx.prisma.webPushSubscription.count()) === 0 ? true : undefined),
            'the subscription to be pruned',
        )
        const row = await waitFor(
            () =>
                ctx.prisma.notification
                    .findFirst({ where: { userId: student.id, type: 'PUSH', error: { not: null } } })
                    .then((r) => r ?? undefined),
            'the delivery error on the row',
        )
        expect(row.error).toContain('410')
        expect(row.sent).toBe(true)
    })
})
