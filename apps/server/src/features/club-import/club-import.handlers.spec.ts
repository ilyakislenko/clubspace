import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ApplyClubImportHandler } from './apply-club-import.handler'
import {
    ApplyClubImportFeature,
    GetClubImportFeature,
    GetClubImportTemplateFeature,
    ListClubImportRowsFeature,
    PreviewClubImportFeature,
    UploadClubImportFeature,
} from './club-import.feature'
import { ClubImportProcessor } from './club-import.processor'
import { GetClubImportHandler } from './get-club-import.handler'
import { GetClubImportTemplateHandler } from './get-club-import-template.handler'
import { ListClubImportRowsHandler } from './list-club-import-rows.handler'
import { PreviewClubImportHandler } from './preview-club-import.handler'
import { UploadClubImportHandler } from './upload-club-import.handler'

import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'

const rbac = (admin = true, clubType = 'GRAPPLING') => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    clubVocabulary: jest.fn().mockResolvedValue(vocabularyForWorkspaceType(clubType)),
})

const stored = (over: Record<string, unknown> = {}) => ({
    id: 'imp1',
    workspaceId: 'w1',
    createdById: 'u1',
    status: 'UPLOADED',
    fileName: 'club.csv',
    encoding: 'utf-8',
    delimiter: ',',
    headers: ['ФИО', 'E-mail'],
    rows: [['Иванов Иван', 'ivan@example.com']],
    mapping: null,
    createMissing: false,
    overwrite: false,
    processed: 0,
    total: 1,
    summary: null,
    missing: null,
    rowResults: null,
    error: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    previewedAt: null,
    appliedAt: null,
    ...over,
})

const prismaWith = (row: object | null, busy: { id: string } | null = null) => ({
    clubImport: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => stored(data)),
        findFirst: jest
            .fn()
            .mockImplementation(async ({ where }: { where: { status?: unknown } }) =>
                where.status ? busy : row,
            ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(row),
    },
})

const caller = ['w1', 'u1', 'coach', false] as const

describe('UploadClubImportHandler', () => {
    const feature = (text: string) =>
        new UploadClubImportFeature({ fileName: 'club.csv', bytes: Buffer.from(text) }, ...caller)

    it('refuses a coach, naming the head coach in the club’s words', async () => {
        const prisma = prismaWith(null)
        await expect(
            new UploadClubImportHandler(prisma as never, rbac(false) as never).execute(feature('a,b\n1,2')),
        ).rejects.toThrow('Импортировать клуб может только администратор или главный тренер')
        expect(prisma.clubImport.create).not.toHaveBeenCalled()
        await expect(
            new UploadClubImportHandler(prisma as never, rbac(false, 'DANCE') as never).execute(feature('a,b\n1,2')),
        ).rejects.toThrow('Импортировать клуб может только администратор или главный педагог')
    })

    it('reads the club’s words only when refusing', async () => {
        const r = rbac()
        await new UploadClubImportHandler(prismaWith(null) as never, r as never).execute(feature('a,b\n1,2'))
        expect(r.clubVocabulary).not.toHaveBeenCalled()
    })

    it('stores the parsed cells and suggests a mapping', async () => {
        const prisma = prismaWith(null)
        const res = await new UploadClubImportHandler(prisma as never, rbac() as never).execute(
            feature('ФИО;E-mail\nИванов Иван;ivan@example.com'),
        )
        expect(prisma.clubImport.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'w1',
            createdById: 'u1',
            delimiter: ';',
            headers: ['ФИО', 'E-mail'],
            rows: [['Иванов Иван', 'ivan@example.com']],
            total: 1,
        })
        expect(res).toMatchObject({ status: 'uploaded', rowCount: 1, mapping: { fullName: 0, email: 1 } })
        expect(res.fields[0]).toEqual({ key: 'fullName', label: 'ФИО' })
    })

    it('rejects an unreadable file before storing anything', async () => {
        const prisma = prismaWith(null)
        await expect(
            new UploadClubImportHandler(prisma as never, rbac() as never).execute(feature('только заголовок')),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.clubImport.create).not.toHaveBeenCalled()
    })
})

describe('GetClubImportHandler / ListClubImportRowsHandler', () => {
    const results = [
        { line: 2, name: 'А', email: null, action: 'create', changes: [], messages: [] },
        { line: 3, name: 'Б', email: null, action: 'skip', changes: [], messages: ['Нет e-mail'] },
        { line: 4, name: 'В', email: null, action: 'skip', changes: [], messages: [] },
    ]

    it('refuses a coach and hides another club’s import', async () => {
        await expect(
            new GetClubImportHandler(prismaWith(stored()) as never, rbac(false) as never).execute(
                new GetClubImportFeature('imp1', ...caller),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        const prisma = prismaWith(null)
        await expect(
            new GetClubImportHandler(prisma as never, rbac() as never).execute(
                new GetClubImportFeature('imp1', ...caller),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.clubImport.findFirst.mock.calls[0][0].where).toEqual({ id: 'imp1', workspaceId: 'w1' })
    })

    it('returns status and the saved mapping', async () => {
        const res = await new GetClubImportHandler(
            prismaWith(stored({ status: 'PREVIEWED', mapping: { email: 1 } })) as never,
            rbac() as never,
        ).execute(new GetClubImportFeature('imp1', ...caller))
        expect(res).toMatchObject({ status: 'previewed', mapping: { email: 1 }, sampleRows: [['Иванов Иван', 'ivan@example.com']] })
    })

    it('pages and filters row results', async () => {
        const handler = new ListClubImportRowsHandler(
            prismaWith(stored({ rowResults: results })) as never,
            rbac() as never,
        )
        const skip = await handler.execute(
            new ListClubImportRowsFeature({ action: 'skip', offset: 1, limit: 1 }, 'imp1', ...caller),
        )
        expect(skip).toEqual({ data: [results[2]], total: 2 })
        const flagged = await handler.execute(
            new ListClubImportRowsFeature({ withMessages: true, offset: 0, limit: 100 }, 'imp1', ...caller),
        )
        expect(flagged).toEqual({ data: [results[1]], total: 1 })
        await expect(
            new ListClubImportRowsHandler(prismaWith(stored()) as never, rbac(false) as never).execute(
                new ListClubImportRowsFeature({ offset: 0, limit: 1 }, 'imp1', ...caller),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('PreviewClubImportHandler / ApplyClubImportHandler', () => {
    const queue = () => ({ add: jest.fn().mockResolvedValue(undefined) })
    const preview = (mapping: Record<string, number>) =>
        new PreviewClubImportFeature({ mapping, createMissing: true, overwrite: false }, 'imp1', ...caller)

    it('refuses a coach', async () => {
        const q = queue()
        await expect(
            new PreviewClubImportHandler(prismaWith(stored()) as never, rbac(false) as never, q as never).execute(
                preview({ email: 1 }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            new ApplyClubImportHandler(prismaWith(stored()) as never, rbac(false) as never, q as never).execute(
                new ApplyClubImportFeature('imp1', ...caller),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(q.add).not.toHaveBeenCalled()
    })

    it('checks the mapping against the file', async () => {
        const handler = new PreviewClubImportHandler(prismaWith(stored()) as never, rbac() as never, queue() as never)
        await expect(handler.execute(preview({ email: 5 }))).rejects.toThrow('нет колонки №6')
        await expect(handler.execute(preview({ email: 1, notes: 1 }))).rejects.toThrow('выбрана и для')
        await expect(handler.execute(preview({ notes: 1 }))).rejects.toThrow('ФИО, именем или e-mail')
    })

    it('saves the mapping and queues the dry run', async () => {
        const prisma = prismaWith(stored())
        const q = queue()
        await new PreviewClubImportHandler(prisma as never, rbac() as never, q as never).execute(
            preview({ fullName: 0, email: 1 }),
        )
        expect(prisma.clubImport.updateMany).toHaveBeenCalledWith({
            where: { id: 'imp1', status: { in: ['UPLOADED', 'PREVIEWED', 'FAILED'] } },
            data: {
                status: 'PREVIEWING',
                processed: 0,
                total: 1,
                error: null,
                mapping: { fullName: 0, email: 1 },
                createMissing: true,
                overwrite: false,
            },
        })
        expect(q.add.mock.calls[0][1]).toEqual({ importId: 'imp1', mode: 'preview' })
    })

    it('runs one import per club at a time', async () => {
        const q = queue()
        await expect(
            new PreviewClubImportHandler(prismaWith(stored(), { id: 'other' }) as never, rbac() as never, q as never).execute(
                preview({ email: 1 }),
            ),
        ).rejects.toBeInstanceOf(ConflictError)
        expect(q.add).not.toHaveBeenCalled()
    })

    it('applies only a previewed import, and not another club’s', async () => {
        const prisma = prismaWith(stored({ status: 'UPLOADED' }))
        prisma.clubImport.updateMany.mockResolvedValue({ count: 0 })
        const q = queue()
        const handler = new ApplyClubImportHandler(prisma as never, rbac() as never, q as never)
        await expect(handler.execute(new ApplyClubImportFeature('imp1', ...caller))).rejects.toThrow(
            'только после проверки',
        )
        await expect(
            new ApplyClubImportHandler(prismaWith(null) as never, rbac() as never, q as never).execute(
                new ApplyClubImportFeature('imp1', ...caller),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(q.add).not.toHaveBeenCalled()
    })

    it('queues the apply and marks the run failed if the queue is down', async () => {
        const prisma = prismaWith(stored({ status: 'PREVIEWED' }))
        const ok = queue()
        await new ApplyClubImportHandler(prisma as never, rbac() as never, ok as never).execute(
            new ApplyClubImportFeature('imp1', ...caller),
        )
        expect(prisma.clubImport.updateMany.mock.calls[0][0]).toMatchObject({
            where: { status: { in: ['PREVIEWED'] } },
            data: { status: 'APPLYING' },
        })
        expect(ok.add.mock.calls[0][1]).toEqual({ importId: 'imp1', mode: 'apply' })

        const down = { add: jest.fn().mockRejectedValue(new Error('redis')) }
        await expect(
            new ApplyClubImportHandler(prisma as never, rbac() as never, down as never).execute(
                new ApplyClubImportFeature('imp1', ...caller),
            ),
        ).rejects.toThrow('redis')
        expect(prisma.clubImport.update).toHaveBeenCalledWith({
            where: { id: 'imp1' },
            data: { status: 'FAILED', error: expect.any(String) },
        })
    })
})

describe('GetClubImportTemplateHandler', () => {
    it('refuses a coach and serves the template to an admin', async () => {
        await expect(
            new GetClubImportTemplateHandler(rbac(false) as never).execute(
                new GetClubImportTemplateFeature(...caller),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        const csv = await new GetClubImportTemplateHandler(rbac() as never).execute(
            new GetClubImportTemplateFeature(...caller),
        )
        expect(csv).toContain('ФИО;E-mail;Телефон')
    })
})

describe('ClubImportProcessor', () => {
    it('runs the engine and records a failure on the import', async () => {
        const prisma = { clubImport: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } }
        const ok = { run: jest.fn().mockResolvedValue(undefined) }
        await new ClubImportProcessor(ok as never, prisma as never).process({
            data: { importId: 'imp1', mode: 'preview' },
        } as never)
        expect(ok.run).toHaveBeenCalledWith('imp1', 'preview')
        expect(prisma.clubImport.updateMany).not.toHaveBeenCalled()

        const broken = { run: jest.fn().mockRejectedValue(new Error('boom')) }
        await new ClubImportProcessor(broken as never, prisma as never).process({
            data: { importId: 'imp1', mode: 'apply' },
        } as never)
        expect(prisma.clubImport.updateMany).toHaveBeenCalledWith({
            where: { id: 'imp1' },
            data: { status: 'FAILED', error: expect.stringContaining('не создаст дублей') },
        })
    })
})
