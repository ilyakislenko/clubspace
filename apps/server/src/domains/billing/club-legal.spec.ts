import {
    clubLegalStatus,
    legalVersionDate,
    missingSellerRequisites,
    parseLegalVersion,
    type SellerRequisites,
} from './club-legal'

const CURRENT = { offerVersion: '2026-12-01', dpaVersion: '2026-11-01' }
const DAY = 86_400_000

describe('parseLegalVersion', () => {
    it('takes an edition date, optionally with a suffix', () => {
        expect(parseLegalVersion(' 2026-11-01 ', 'X')).toBe('2026-11-01')
        expect(parseLegalVersion('2026-11-01.2', 'X')).toBe('2026-11-01.2')
    })

    it('refuses anything that is not an edition date', () => {
        expect(() => parseLegalVersion('v2', 'PLATFORM_OFFER_VERSION')).toThrow(
            'PLATFORM_OFFER_VERSION',
        )
        expect(() => parseLegalVersion('2026-13-45', 'X')).toThrow()
        expect(() => parseLegalVersion(`2026-11-01.${'a'.repeat(60)}`, 'X')).toThrow()
    })

    it('reads the effective date from the version', () => {
        expect(legalVersionDate('2026-11-01.2').toISOString()).toBe('2026-11-01T00:00:00.000Z')
    })
})

describe('clubLegalStatus', () => {
    const base = {
        current: CURRENT,
        clubCreatedAt: new Date('2026-01-10T00:00:00.000Z'),
        graceDays: 14,
    }

    it('is up to date when the latest acceptance covers both editions', () => {
        expect(
            clubLegalStatus({ ...base, accepted: CURRENT, now: new Date('2027-06-01T00:00:00.000Z') }),
        ).toEqual({ upToDate: true, acceptBy: null, required: false })
    })

    it('gives the grace from the new edition’s date, then requires acceptance', () => {
        const accepted = { offerVersion: '2026-11-01', dpaVersion: '2026-11-01' }
        const inGrace = clubLegalStatus({
            ...base,
            accepted,
            now: new Date('2026-12-14T23:59:59.000Z'),
        })
        expect(inGrace).toEqual({
            upToDate: false,
            acceptBy: new Date('2026-12-15T00:00:00.000Z'),
            required: false,
        })
        const after = clubLegalStatus({ ...base, accepted, now: new Date('2026-12-15T00:00:00.000Z') })
        expect(after.required).toBe(true)
    })

    it('counts a club created after the edition from its creation', () => {
        const created = new Date('2027-02-01T12:00:00.000Z')
        const status = clubLegalStatus({
            ...base,
            clubCreatedAt: created,
            accepted: null,
            now: new Date(created.getTime() + 13 * DAY),
        })
        expect(status.acceptBy).toEqual(new Date(created.getTime() + 14 * DAY))
        expect(status.required).toBe(false)
    })

    it('uses the later date of the editions not accepted', () => {
        const status = clubLegalStatus({
            ...base,
            current: { offerVersion: '2026-11-01', dpaVersion: '2027-03-01' },
            accepted: { offerVersion: '2026-10-01', dpaVersion: '2026-11-01' },
            now: new Date('2027-03-02T00:00:00.000Z'),
        })
        expect(status.acceptBy).toEqual(new Date('2027-03-15T00:00:00.000Z'))
    })
})

describe('missingSellerRequisites', () => {
    const seller: SellerRequisites = {
        name: 'ИП Тестов',
        inn: '770000000000',
        ogrnip: '300000000000000',
        address: 'г. Москва',
        bankName: 'Банк',
        bik: '044525000',
        account: '40802810000000000000',
        corrAccount: '',
        email: '',
        phone: '',
    }

    it('needs everything an invoice names; contacts and the corr. account are optional', () => {
        expect(missingSellerRequisites(seller)).toEqual([])
        expect(missingSellerRequisites({ ...seller, inn: ' ', bik: '' })).toEqual(['inn', 'bik'])
    })
})
