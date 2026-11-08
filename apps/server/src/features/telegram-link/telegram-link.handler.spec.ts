import { hashTelegramLinkToken } from '../../domains/telegram/telegram-utils'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { CreateTelegramLinkHandler } from './create-telegram-link.handler'
import { GetMyTelegramHandler } from './get-my-telegram.handler'
import { HandleTelegramWebhookHandler, TELEGRAM_REPLIES } from './handle-telegram-webhook.handler'
import {
    CreateTelegramLinkFeature,
    GetMyTelegramFeature,
    HandleTelegramWebhookFeature,
    UnlinkMyTelegramFeature,
    UpdateMyTelegramFeature,
} from './telegram-link.feature'
import { UnlinkMyTelegramHandler } from './unlink-my-telegram.handler'
import { UpdateMyTelegramHandler } from './update-my-telegram.handler'

const SECRET = 'webhook-secret'

type TokenRow = {
    id: string
    userId: string
    tokenHash: string
    expiresAt: Date
    usedAt: Date | null
}
type LinkRow = { userId: string; chatId: string; linkedAt: Date }
type PrefsRow = { userId: string; telegramEnabled: boolean }

// In-memory stand-in for the three tables, so the specs follow a token from
// issue to use instead of asserting on canned rows.
const fakePrisma = () => {
    const tokens: TokenRow[] = []
    const links: LinkRow[] = []
    const prefs: PrefsRow[] = []
    let seq = 0
    const matchLink = (row: LinkRow, where: Record<string, unknown>): boolean => {
        if (Array.isArray(where.OR)) {
            return (where.OR as Record<string, unknown>[]).some((w) => matchLink(row, w))
        }
        return Object.entries(where).every(
            ([k, v]) => (row as Record<string, unknown>)[k] === v,
        )
    }
    const remove = <T>(list: T[], keep: (row: T) => boolean): number => {
        const before = list.length
        const kept = list.filter(keep)
        list.splice(0, list.length, ...kept)
        return before - kept.length
    }
    const prisma = {
        telegramLinkToken: {
            deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => ({
                count: remove(tokens, (t) => t.userId !== where.userId),
            })),
            create: jest.fn(async ({ data }: { data: Omit<TokenRow, 'id' | 'usedAt'> }) => {
                const row = { id: `t${++seq}`, usedAt: null, ...data }
                tokens.push(row)
                return row
            }),
            findUnique: jest.fn(
                async ({ where }: { where: { tokenHash: string } }) =>
                    tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
            ),
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: string; usedAt: null; expiresAt: { gt: Date } }
                    data: { usedAt: Date }
                }) => {
                    const hit = tokens.filter(
                        (t) =>
                            t.id === where.id &&
                            t.usedAt === null &&
                            t.expiresAt.getTime() > where.expiresAt.gt.getTime(),
                    )
                    for (const t of hit) t.usedAt = data.usedAt
                    return { count: hit.length }
                },
            ),
        },
        telegramLink: {
            findUnique: jest.fn(
                async ({ where }: { where: { userId: string } }) =>
                    links.find((l) => l.userId === where.userId) ?? null,
            ),
            deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
                count: remove(links, (l) => !matchLink(l, where)),
            })),
            create: jest.fn(async ({ data }: { data: LinkRow }) => {
                if (links.some((l) => l.chatId === data.chatId || l.userId === data.userId)) {
                    throw Object.assign(new Error('unique'), { code: 'P2002' })
                }
                links.push(data)
                return data
            }),
        },
        notificationPreferences: {
            findUnique: jest.fn(
                async ({ where }: { where: { userId: string } }) =>
                    prefs.find((p) => p.userId === where.userId) ?? null,
            ),
            upsert: jest.fn(
                async ({
                    where,
                    create,
                    update,
                }: {
                    where: { userId: string }
                    create: PrefsRow
                    update: { telegramEnabled: boolean }
                }) => {
                    const row = prefs.find((p) => p.userId === where.userId)
                    if (row) Object.assign(row, update)
                    else prefs.push({ userId: create.userId, telegramEnabled: create.telegramEnabled })
                },
            ),
        },
        $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    }
    return { prisma, tokens, links, prefs }
}

const build = (o: { available?: boolean } = {}) => {
    const db = fakePrisma()
    const bot = {
        available: o.available ?? true,
        botUsername: 'club_bot',
        webhookSecret: SECRET,
        sendMessage: jest.fn().mockResolvedValue({ status: 'ok' }),
    }
    const p = db.prisma as never
    const b = bot as never
    return {
        ...db,
        bot,
        create: new CreateTelegramLinkHandler(p, b),
        status: new GetMyTelegramHandler(p, b),
        update: new UpdateMyTelegramHandler(p, b),
        unlink: new UnlinkMyTelegramHandler(p, b),
        webhook: new HandleTelegramWebhookHandler(p, b),
    }
}

const update = (text: string, chatId: number | string = 555, type = 'private') => ({
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId, type }, from: { id: 555 }, text },
})

const tokenOf = (url: string) => new URL(url).searchParams.get('start') as string

const send = (h: ReturnType<typeof build>, text: string, chatId?: number | string) =>
    h.webhook.execute(new HandleTelegramWebhookFeature(SECRET, update(text, chatId)))

describe('Telegram linking', () => {
    afterEach(() => jest.useRealTimers())

    describe('POST /me/telegram/link', () => {
        it('returns a one-time deep link and stores only the token hash, 15 minutes', async () => {
            const h = build()
            const before = Date.now()
            const out = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            expect(out.url).toMatch(/^https:\/\/t\.me\/club_bot\?start=[A-Za-z0-9_-]{32}$/)
            const token = tokenOf(out.url)
            expect(h.tokens).toHaveLength(1)
            expect(h.tokens[0].tokenHash).toBe(hashTelegramLinkToken(token))
            expect(JSON.stringify(h.tokens)).not.toContain(token)
            const ttl = h.tokens[0].expiresAt.getTime() - before
            expect(ttl).toBeGreaterThanOrEqual(15 * 60_000 - 1000)
            expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 1000)
            expect(out.expiresAt).toBe(h.tokens[0].expiresAt.toISOString())
        })

        it('refuses while the bot is not configured', async () => {
            const h = build({ available: false })
            await expect(
                h.create.execute(new CreateTelegramLinkFeature('u1')),
            ).rejects.toBeInstanceOf(BadRequestError)
            expect(h.tokens).toHaveLength(0)
        })
    })

    describe('webhook /start <token>', () => {
        it('links the chat, turns Telegram on and confirms in the chat', async () => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            expect(await send(h, `/start ${tokenOf(url)}`)).toEqual({ ok: true })
            expect(h.links).toEqual([expect.objectContaining({ userId: 'u1', chatId: '555' })])
            expect(h.prefs).toEqual([{ userId: 'u1', telegramEnabled: true }])
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.linked)
            expect(await h.status.execute(new GetMyTelegramFeature('u1'))).toEqual({
                available: true,
                linked: true,
                enabled: true,
            })
        })

        it('refuses a reused token', async () => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await send(h, `/start ${tokenOf(url)}`)
            h.bot.sendMessage.mockClear()
            await send(h, `/start ${tokenOf(url)}`, 999)
            expect(h.links).toEqual([expect.objectContaining({ userId: 'u1', chatId: '555' })])
            expect(h.bot.sendMessage).toHaveBeenCalledWith('999', TELEGRAM_REPLIES.expired)
        })

        it('refuses an expired token', async () => {
            jest.useFakeTimers({ now: new Date('2026-11-08T10:00:00Z') })
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            jest.setSystemTime(new Date('2026-11-08T10:15:01Z'))
            await send(h, `/start ${tokenOf(url)}`)
            expect(h.links).toHaveLength(0)
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.expired)
        })

        it('refuses a superseded token once a new link was requested', async () => {
            const h = build()
            const first = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await send(h, `/start ${tokenOf(first.url)}`)
            expect(h.links).toHaveLength(0)
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.unknown)
        })

        it.each(['A'.repeat(32), 'not-a-token!'])('refuses an unknown token %s', async (token) => {
            const h = build()
            await send(h, `/start ${token}`)
            expect(h.links).toHaveLength(0)
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.unknown)
        })

        it('moves a chat that served another account to the new one', async () => {
            const h = build()
            const a = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await send(h, `/start ${tokenOf(a.url)}`)
            const b = await h.create.execute(new CreateTelegramLinkFeature('u2'))
            await send(h, `/start ${tokenOf(b.url)}`)
            expect(h.links).toEqual([expect.objectContaining({ userId: 'u2', chatId: '555' })])
        })

        it('answers a bare /start with how to link', async () => {
            const h = build()
            await send(h, '/start')
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.hint)
        })

        it('ignores group chats and other messages', async () => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await h.webhook.execute(
                new HandleTelegramWebhookFeature(
                    SECRET,
                    update(`/start ${tokenOf(url)}`, -100, 'group'),
                ),
            )
            await send(h, 'привет')
            await h.webhook.execute(new HandleTelegramWebhookFeature(SECRET, { update_id: 2 }))
            expect(h.links).toHaveLength(0)
            expect(h.bot.sendMessage).not.toHaveBeenCalled()
        })
    })

    describe('webhook secret', () => {
        it.each([undefined, '', 'wrong'])('refuses secret %p', async (secret) => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await expect(
                h.webhook.execute(
                    new HandleTelegramWebhookFeature(secret, update(`/start ${tokenOf(url)}`)),
                ),
            ).rejects.toBeInstanceOf(ForbiddenError)
            expect(h.links).toHaveLength(0)
            expect(h.tokens[0].usedAt).toBeNull()
        })

        it('is not there while the bot is not configured', async () => {
            const h = build({ available: false })
            await expect(send(h, '/stop')).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('unlinking', () => {
        const linked = async () => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await send(h, `/start ${tokenOf(url)}`)
            h.bot.sendMessage.mockClear()
            return h
        }

        it('/stop in the chat unlinks it', async () => {
            const h = await linked()
            await send(h, '/stop')
            expect(h.links).toHaveLength(0)
            expect(h.bot.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_REPLIES.stopped)
        })

        it('/stop from another chat leaves the link alone', async () => {
            const h = await linked()
            await send(h, '/stop', 999)
            expect(h.links).toHaveLength(1)
        })

        it('DELETE /me/telegram unlinks and drops pending tokens', async () => {
            const h = await linked()
            await h.create.execute(new CreateTelegramLinkFeature('u1'))
            expect(await h.unlink.execute(new UnlinkMyTelegramFeature('u1'))).toEqual({
                available: true,
                linked: false,
                enabled: false,
            })
            expect(h.links).toHaveLength(0)
            expect(h.tokens).toHaveLength(0)
        })
    })

    describe('PATCH /me/telegram', () => {
        it('switches the copies off and on without unlinking', async () => {
            const h = build()
            const { url } = await h.create.execute(new CreateTelegramLinkFeature('u1'))
            await send(h, `/start ${tokenOf(url)}`)
            expect(
                await h.update.execute(new UpdateMyTelegramFeature('u1', { enabled: false })),
            ).toEqual({ available: true, linked: true, enabled: false })
            expect(h.prefs).toEqual([{ userId: 'u1', telegramEnabled: false }])
            expect(
                await h.update.execute(new UpdateMyTelegramFeature('u1', { enabled: true })),
            ).toEqual({ available: true, linked: true, enabled: true })
        })

        it('refuses before a chat is linked', async () => {
            const h = build()
            await expect(
                h.update.execute(new UpdateMyTelegramFeature('u1', { enabled: true })),
            ).rejects.toBeInstanceOf(BadRequestError)
            expect(h.prefs).toHaveLength(0)
        })
    })

    describe('GET /me/telegram', () => {
        it('reports unavailable, without reading anything, when the bot is off', async () => {
            const h = build({ available: false })
            expect(await h.status.execute(new GetMyTelegramFeature('u1'))).toEqual({
                available: false,
                linked: false,
                enabled: false,
            })
            expect(h.prisma.telegramLink.findUnique).not.toHaveBeenCalled()
        })

        it('reports not linked for a fresh account', async () => {
            const h = build()
            expect(await h.status.execute(new GetMyTelegramFeature('u1'))).toEqual({
                available: true,
                linked: false,
                enabled: false,
            })
        })
    })
})
