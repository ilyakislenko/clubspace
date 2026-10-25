import { coachDigestCounts, retentionDigestSlot } from './digest-slot'
import type { WorkspaceRiskEntry } from './load-workspace-risk'

describe('retentionDigestSlot', () => {
    // 2026-10-26 is a Monday. Asia/Tomsk is UTC+7.
    it('is due on Monday at 10:05 club time', () => {
        expect(retentionDigestSlot(new Date('2026-10-26T03:05:00Z'), 'Asia/Tomsk')).toEqual({
            due: true,
            localYmd: '2026-10-26',
        })
    })

    it('is not due at 09:59 or 11:00', () => {
        expect(retentionDigestSlot(new Date('2026-10-26T02:59:00Z'), 'Asia/Tomsk').due).toBe(false)
        expect(retentionDigestSlot(new Date('2026-10-26T04:00:00Z'), 'Asia/Tomsk').due).toBe(false)
    })

    it('is not due on Sunday at 10:00', () => {
        expect(retentionDigestSlot(new Date('2026-10-25T03:00:00Z'), 'Asia/Tomsk').due).toBe(false)
    })

    it('uses the local day, not the UTC one', () => {
        // Monday 10:00 in Sydney (UTC+11) is still Sunday in UTC.
        expect(retentionDigestSlot(new Date('2026-10-25T23:00:00Z'), 'Australia/Sydney')).toEqual({
            due: true,
            localYmd: '2026-10-26',
        })
    })

    it('follows the local hour across a DST change', () => {
        // Berlin: CEST (UTC+2) until Sun 25 Oct 2026, CET (UTC+1) after.
        expect(retentionDigestSlot(new Date('2026-10-26T09:30:00Z'), 'Europe/Berlin').due).toBe(true)
        expect(retentionDigestSlot(new Date('2026-10-19T08:30:00Z'), 'Europe/Berlin').due).toBe(true)
        expect(retentionDigestSlot(new Date('2026-10-26T08:30:00Z'), 'Europe/Berlin').due).toBe(false)
    })
})

describe('coachDigestCounts', () => {
    const entry = (
        userId: string,
        groupIds: string[],
        reason: 'absent' | 'lapsed',
        snoozed = false,
    ) =>
        ({
            userId,
            groups: groupIds.map((id) => ({ id, name: id, gymId: null, gymName: null })),
            risk: { reason, signals: [reason] },
            snoozed,
        }) as unknown as WorkspaceRiskEntry

    const entries = [
        entry('s1', ['g1'], 'absent'),
        entry('s2', ['g1'], 'lapsed'),
        entry('s3', ['g1'], 'absent', true),
        entry('s4', ['g2'], 'absent'),
        entry('s5', [], 'absent'),
    ]

    it('counts non-snoozed members of the coach groups by reason', () => {
        const res = coachDigestCounts(entries, [{ userId: 'c1', groupId: 'g1' }])
        expect(res.get('c1')).toEqual({
            total: 2,
            byReason: { lapsed: 1, newcomer: 0, absent: 1, declining: 0 },
        })
    })

    it('counts an assistant coach through the junction rows', () => {
        const res = coachDigestCounts(entries, [
            { userId: 'c1', groupId: 'g1' },
            { userId: 'c2', groupId: 'g2' },
            { userId: 'c2', groupId: 'g1' },
        ])
        expect(res.get('c2')?.total).toBe(3)
    })

    it('returns a zero entry for a coach with no at-risk members', () => {
        const res = coachDigestCounts(entries, [{ userId: 'c3', groupId: 'g9' }])
        expect(res.get('c3')?.total).toBe(0)
    })
})
