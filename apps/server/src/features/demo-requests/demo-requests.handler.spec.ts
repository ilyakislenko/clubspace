import { environment } from '../../environments/environment'
import {
    CreateDemoRequestHandler,
    DEMO_CONSENT_REQUIRED,
} from './create-demo-request.handler'
import { demoRequestEmail } from './demo-request-utils'
import {
    CreateDemoRequestFeature,
    CreateDemoRequestInputSchema,
    ListPlatformDemoRequestsFeature,
} from './demo-requests.feature'
import { ListPlatformDemoRequestsHandler } from './list-platform-demo-requests.handler'

const ROW = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Илья',
    clubName: 'Академия <BJJ>',
    city: 'Томск',
    contact: '@ilya',
    studentsCount: 180,
    comment: null,
    consentAt: new Date('2026-11-01T09:00:00Z'),
    createdAt: new Date('2026-11-01T09:00:00Z'),
}

const VALID = {
    name: 'Илья',
    clubName: 'Академия <BJJ>',
    city: 'Томск',
    contact: '@ilya',
    studentsCount: 180,
    consent: true,
}

const buildCreate = () => {
    const prisma = {
        demoRequest: {
            create: jest.fn(async ({ data }) => ({
                ...ROW,
                ...data,
                id: ROW.id,
                createdAt: ROW.createdAt,
            })),
        },
    }
    const notifications = { sendEmailToAddress: jest.fn().mockResolvedValue(undefined) }
    const handler = new CreateDemoRequestHandler(prisma as never, notifications as never)
    const run = (input: object) =>
        handler.execute(
            new CreateDemoRequestFeature(CreateDemoRequestInputSchema.parse(input)),
        )
    return { prisma, notifications, run }
}

describe('createDemoRequest', () => {
    it('stores the request with the consent time and mails the platform owner', async () => {
        const { prisma, notifications, run } = buildCreate()
        await expect(run({ ...VALID, comment: '  ' })).resolves.toEqual({
            status: 'received',
        })
        const data = prisma.demoRequest.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            name: 'Илья',
            clubName: 'Академия <BJJ>',
            city: 'Томск',
            contact: '@ilya',
            studentsCount: 180,
            comment: null,
        })
        expect(data.consentAt).toBeInstanceOf(Date)
        const mail = notifications.sendEmailToAddress.mock.calls[0][0]
        expect(mail.to).toBe(environment.adminEmail)
        expect(mail.subject).toBe('Заявка на демо: Академия <BJJ>')
        expect(mail.html).toContain('Академия &lt;BJJ&gt;')
        expect(mail.html).not.toContain('<BJJ>')
    })

    it('refuses without consent and stores nothing', async () => {
        const { prisma, notifications, run } = buildCreate()
        await expect(run({ ...VALID, consent: false })).rejects.toMatchObject({
            message: DEMO_CONSENT_REQUIRED,
        })
        expect(prisma.demoRequest.create).not.toHaveBeenCalled()
        expect(notifications.sendEmailToAddress).not.toHaveBeenCalled()
    })

    it('answers a filled honeypot like a success and drops it', async () => {
        const { prisma, notifications, run } = buildCreate()
        await expect(
            run({ ...VALID, website: 'http://spam.example' }),
        ).resolves.toEqual({ status: 'received' })
        expect(prisma.demoRequest.create).not.toHaveBeenCalled()
        expect(notifications.sendEmailToAddress).not.toHaveBeenCalled()
    })

    it('keeps the request when the mail cannot be queued', async () => {
        const { prisma, notifications, run } = buildCreate()
        notifications.sendEmailToAddress.mockRejectedValueOnce(new Error('redis down'))
        await expect(run(VALID)).resolves.toEqual({ status: 'received' })
        expect(prisma.demoRequest.create).toHaveBeenCalledTimes(1)
    })
})

describe('demoRequestEmail', () => {
    it('leaves out empty fields and the console link when there is no admin URL', () => {
        const mail = demoRequestEmail(
            { ...ROW, city: null, studentsCount: null, comment: 'line1\nline2' },
            null,
        )
        expect(mail.html).not.toContain('Город')
        expect(mail.html).not.toContain('Учеников')
        expect(mail.html).toContain('line1\nline2')
        expect(mail.html).not.toContain('<a ')
    })

    it('links the console and keeps the subject on one line', () => {
        const mail = demoRequestEmail(
            { ...ROW, clubName: 'Клуб\r\nBcc: x@example.com' },
            'https://admin.example.com/platform',
        )
        expect(mail.subject).toBe('Заявка на демо: Клуб Bcc: x@example.com')
        expect(mail.html).toContain('href="https://admin.example.com/platform"')
    })
})

describe('listPlatformDemoRequests', () => {
    const build = () => {
        const prisma = { demoRequest: { findMany: jest.fn().mockResolvedValue([ROW]) } }
        return { prisma, handler: new ListPlatformDemoRequestsHandler(prisma as never) }
    }

    it('refuses anyone but a platform admin', async () => {
        const { prisma, handler } = build()
        await expect(
            handler.execute(new ListPlatformDemoRequestsFeature('u1', false)),
        ).rejects.toMatchObject({ statusCode: 403 })
        expect(prisma.demoRequest.findMany).not.toHaveBeenCalled()
    })

    it('lists requests newest first, serialized', async () => {
        const { prisma, handler } = build()
        const out = await handler.execute(new ListPlatformDemoRequestsFeature('u1', true))
        expect(prisma.demoRequest.findMany.mock.calls[0][0]).toEqual({
            orderBy: { createdAt: 'desc' },
            take: 200,
        })
        expect(out.data).toEqual([
            {
                ...ROW,
                consentAt: '2026-11-01T09:00:00.000Z',
                createdAt: '2026-11-01T09:00:00.000Z',
            },
        ])
    })
})
