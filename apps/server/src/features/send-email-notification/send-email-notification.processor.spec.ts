import { Logger } from '@nestjs/common'
import { UnrecoverableError } from 'bullmq'

import {
    DEMO_EMAIL_SKIPPED,
    SendEmailNotificationProcessor,
} from './send-email-notification.processor'

const transportError = () =>
    Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
const recipientError = () =>
    Object.assign(new Error('550 no such user'), { code: 'EENVELOPE' })

const ROW = {
    topic: 'Код для входа: 123456',
    message: '<p>123456</p>',
    sent: false,
    metadata: null as unknown,
    user: { isDemo: false },
}

const setup = (opts: { row?: typeof ROW | null; sendMail?: jest.Mock } = {}) => {
    const prisma = {
        notification: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.row === undefined ? ROW : opts.row),
        },
    }
    const sendMail =
        opts.sendMail ?? jest.fn().mockResolvedValue({ messageId: 'm1', response: '250 OK' })
    const notifications = {
        updateNotificationStatus: jest.fn().mockResolvedValue(undefined),
    }
    const mailHealth = { recordDelivered: jest.fn(), recordFailure: jest.fn() }
    const processor = new SendEmailNotificationProcessor(
        prisma as never,
        { sendMail } as never,
        notifications as never,
        mailHealth as never,
    )
    return { processor, prisma, sendMail, notifications, mailHealth }
}

const job = (attemptsMade = 0) =>
    ({
        data: { notificationId: 'n1', to: 'a@b.com' },
        attemptsMade,
        opts: { attempts: 5 },
    }) as never

describe('SendEmailNotificationProcessor', () => {
    let logSpies: jest.SpyInstance[]
    beforeEach(() => {
        logSpies = [
            jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
            jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
        ]
    })
    afterEach(() => logSpies.forEach((s) => s.mockRestore()))

    it('sends the stored subject and body, then records only the message id', async () => {
        const { processor, sendMail, notifications, mailHealth } = setup()

        await processor.process(job())

        const mail = sendMail.mock.calls[0][0]
        expect(mail.to).toBe('a@b.com')
        expect(mail.subject).toBe(ROW.topic)
        expect(mail.html).toContain(ROW.message)
        expect(mail.html).toContain(`<title>${ROW.topic}</title>`)
        expect(mailHealth.recordDelivered).toHaveBeenCalledTimes(1)
        expect(notifications.updateNotificationStatus).toHaveBeenCalledWith({
            id: 'n1',
            sent: true,
            sentPayload: { messageId: 'm1' },
        })
    })

    it('escapes a staff-typed subject inside <title>, leaving the Subject header raw', async () => {
        const topic = '</title></head><body><a href="https://evil.example">Войти</a> — Клуб'
        const { processor, sendMail } = setup({ row: { ...ROW, topic } })
        await processor.process(job())
        const mail = sendMail.mock.calls[0][0]
        expect(mail.subject).toBe(topic)
        expect(mail.html).not.toContain('<a href="https://evil.example">')
        expect(mail.html).toContain(
            '<title>&lt;/title&gt;&lt;/head&gt;&lt;body&gt;&lt;a href=&quot;https://evil.example&quot;&gt;Войти&lt;/a&gt; — Клуб</title>',
        )
    })

    it('skips a notification that is gone or already delivered', async () => {
        for (const row of [null, { ...ROW, sent: true }]) {
            const { processor, sendMail } = setup({ row })
            await processor.process(job())
            expect(sendMail).not.toHaveBeenCalled()
        }
    })

    it('sends a club message with its one-click unsubscribe headers (RFC 8058)', async () => {
        const url = 'https://api.example/public/unsubscribe/club-messages?token=u.mac'
        const { processor, sendMail } = setup({
            row: { ...ROW, metadata: { kind: 'message.broadcast', unsubscribeUrl: url } },
        })
        await processor.process(job())
        expect(sendMail.mock.calls[0][0].headers).toEqual({
            'List-Unsubscribe': `<${url}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        })
    })

    it('adds no unsubscribe headers to other mail', async () => {
        const { processor, sendMail } = setup()
        await processor.process(job())
        expect(sendMail.mock.calls[0][0].headers).toBeUndefined()
    })

    it('never mails a demo account: the inbox row stays, marked not sent', async () => {
        const { processor, sendMail, notifications, mailHealth } = setup({
            row: { ...ROW, user: { isDemo: true } },
        })
        await processor.process(job())
        expect(sendMail).not.toHaveBeenCalled()
        expect(mailHealth.recordDelivered).not.toHaveBeenCalled()
        expect(notifications.updateNotificationStatus).toHaveBeenCalledWith({
            id: 'n1',
            sent: false,
            error: DEMO_EMAIL_SKIPPED,
        })
    })

    it('rethrows a transport blip for a BullMQ retry without reporting an outage yet', async () => {
        const { processor, notifications, mailHealth } = setup({
            sendMail: jest.fn().mockRejectedValue(transportError()),
        })

        await expect(processor.process(job(0))).rejects.toThrow('ETIMEDOUT')

        expect(mailHealth.recordFailure).not.toHaveBeenCalled()
        expect(notifications.updateNotificationStatus).not.toHaveBeenCalled()
    })

    it('reports the outage and records the failure on the last attempt', async () => {
        const { processor, notifications, mailHealth } = setup({
            sendMail: jest.fn().mockRejectedValue(transportError()),
        })

        await expect(processor.process(job(4))).rejects.toThrow('ETIMEDOUT')

        expect(mailHealth.recordFailure).toHaveBeenCalledTimes(1)
        expect(notifications.updateNotificationStatus).toHaveBeenCalledWith({
            id: 'n1',
            sent: false,
            error: 'connect ETIMEDOUT',
        })
    })

    it('does not retry a rejected recipient', async () => {
        const { processor, notifications } = setup({
            sendMail: jest.fn().mockRejectedValue(recipientError()),
        })

        await expect(processor.process(job(0))).rejects.toBeInstanceOf(
            UnrecoverableError,
        )
        expect(notifications.updateNotificationStatus).toHaveBeenCalledWith({
            id: 'n1',
            sent: false,
            error: '550 no such user',
        })
    })
})
