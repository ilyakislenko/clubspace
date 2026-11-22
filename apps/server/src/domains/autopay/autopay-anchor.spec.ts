import { type AutopayAbonementRow, lastUsedAt } from './autopay-anchor'

const row = (over: Partial<AutopayAbonementRow>): AutopayAbonementRow =>
    ({
        updatedAt: new Date('2026-11-01T10:00:00Z'),
        consumedRecords: [],
        burnedBookings: [],
        ...over,
    }) as AutopayAbonementRow

describe('lastUsedAt', () => {
    it('is the later of the last check-in and the last burned class', () => {
        const checkIn = new Date('2026-11-20T10:00:00Z')
        const burn = new Date('2026-11-20T18:00:00Z')
        expect(
            lastUsedAt(row({ consumedRecords: [{ markedAt: checkIn }], burnedBookings: [{ updatedAt: burn }] })),
        ).toEqual(burn)
        expect(
            lastUsedAt(
                row({
                    consumedRecords: [{ markedAt: burn }],
                    burnedBookings: [{ updatedAt: checkIn }],
                }),
            ),
        ).toEqual(burn)
    })

    it('falls back to the row’s last write when the pack has neither', () => {
        expect(lastUsedAt(row({}))).toEqual(new Date('2026-11-01T10:00:00Z'))
    })
})
