const legalEnv = {
    offerVersion: '2026-12-01',
    dpaVersion: '2026-11-01',
    acceptGraceDays: 14,
    seller: {
        name: 'ИП Тестов Тест Тестович',
        inn: '770000000000',
        ogrnip: ' ',
        address: 'г. Москва',
        bankName: 'АО «Банк»',
        bik: '044525000',
        account: '40802810000000000000',
        corrAccount: '',
        email: 'billing@clubspace.test',
        phone: '',
    },
}
jest.mock('../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return { legal: legalEnv }
        },
    },
}))

import { GetPublicLegalHandler } from './get-public-legal.handler'
import { platformClubLegal } from './schemas'

describe('GetPublicLegalHandler', () => {
    it('serves the editions and the requisites, blanks as null', async () => {
        await expect(new GetPublicLegalHandler().execute()).resolves.toEqual({
            offerVersion: '2026-12-01',
            dpaVersion: '2026-11-01',
            acceptGraceDays: 14,
            seller: {
                name: 'ИП Тестов Тест Тестович',
                inn: '770000000000',
                ogrnip: null,
                address: 'г. Москва',
                bankName: 'АО «Банк»',
                bik: '044525000',
                account: '40802810000000000000',
                corrAccount: null,
                email: 'billing@clubspace.test',
                phone: null,
            },
            sellerComplete: false,
        })
    })
})

describe('platformClubLegal', () => {
    const row = (o: Record<string, unknown>) => ({
        id: '00000000-0000-4000-8000-000000000001',
        workspaceId: 'w1',
        userId: '00000000-0000-4000-8000-000000000002',
        userEmail: 'owner@club.ru',
        userName: 'Иван Петров',
        offerVersion: '2026-11-01',
        dpaVersion: '2026-11-01',
        source: 'SIGNUP',
        acceptedAt: new Date('2026-11-02T00:00:00.000Z'),
        ip: '10.0.0.1',
        userAgent: 'Safari',
        recordedById: null,
        paymentId: null,
        ...o,
    })

    it('derives the status from the newest row and lists the evidence', () => {
        const out = platformClubLegal({
            current: { offerVersion: '2026-12-01', dpaVersion: '2026-11-01' },
            acceptances: [row({}) as never],
            clubCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
            now: new Date('2026-12-20T00:00:00.000Z'),
        })
        expect(out).toMatchObject({
            upToDate: false,
            acceptBy: '2026-12-15T00:00:00.000Z',
            required: true,
            accepted: { offerVersion: '2026-11-01', source: 'SIGNUP', userName: 'Иван Петров' },
        })
        expect(out.acceptances).toEqual([
            {
                id: '00000000-0000-4000-8000-000000000001',
                source: 'SIGNUP',
                offerVersion: '2026-11-01',
                dpaVersion: '2026-11-01',
                acceptedAt: '2026-11-02T00:00:00.000Z',
                userId: '00000000-0000-4000-8000-000000000002',
                userEmail: 'owner@club.ru',
                userName: 'Иван Петров',
                ip: '10.0.0.1',
                userAgent: 'Safari',
                recordedById: null,
                paymentId: null,
            },
        ])
    })

    it('reads a club with no acceptance as never accepted', () => {
        const out = platformClubLegal({
            current: { offerVersion: '2026-12-01', dpaVersion: '2026-11-01' },
            acceptances: [],
            clubCreatedAt: new Date('2027-01-01T00:00:00.000Z'),
            now: new Date('2027-01-02T00:00:00.000Z'),
        })
        expect(out).toMatchObject({
            accepted: null,
            upToDate: false,
            acceptBy: '2027-01-15T00:00:00.000Z',
            required: false,
            acceptances: [],
        })
    })
})
