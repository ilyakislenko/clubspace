import { localDateInTz } from '../../features/attendance/attendance-utils'
import {
    birthdateTurningOn,
    birthdayGreeting,
    isBirthdayOn,
    loadBirthdayMembers,
    turnsOn,
} from './birthdays'

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

describe('isBirthdayOn', () => {
    it('matches the month-day, any year', () => {
        expect(isBirthdayOn(d('2016-05-04'), '2026-05-04')).toBe(true)
        expect(isBirthdayOn(d('2016-05-04'), '2026-05-05')).toBe(false)
        expect(isBirthdayOn(d('2016-05-04'), '2026-04-05')).toBe(false)
    })

    it('celebrates 29 February on 28 February in a non-leap year only', () => {
        expect(isBirthdayOn(d('2016-02-29'), '2027-02-28')).toBe(true)
        expect(isBirthdayOn(d('2016-02-29'), '2028-02-28')).toBe(false)
        expect(isBirthdayOn(d('2016-02-29'), '2028-02-29')).toBe(true)
        expect(isBirthdayOn(d('2016-02-29'), '2027-03-01')).toBe(false)
        expect(isBirthdayOn(d('2016-02-28'), '2028-02-29')).toBe(false)
        // 2100 is not a leap year.
        expect(isBirthdayOn(d('2016-02-29'), '2100-02-28')).toBe(true)
    })

    it('uses the club-local date, not UTC: 23:30 UTC is already the next day in Tomsk', () => {
        const instant = new Date('2026-05-03T23:30:00.000Z')
        expect(isBirthdayOn(d('2016-05-04'), localDateInTz(instant, 'Asia/Tomsk'))).toBe(true)
        expect(isBirthdayOn(d('2016-05-04'), localDateInTz(instant, 'America/New_York'))).toBe(false)
    })
})

describe('turnsOn / birthdateTurningOn', () => {
    it('gives the age reached on the day', () => {
        expect(turnsOn(d('2016-05-04'), '2026-05-04')).toBe(10)
    })

    it('builds a birthday today, a leap year for 29 February', () => {
        expect(birthdateTurningOn('2026-11-26', 7)).toBe('2019-11-26')
        expect(birthdateTurningOn('2028-02-29', 7)).toBe('2020-02-29')
        expect(isBirthdayOn(d(birthdateTurningOn('2028-02-29', 7)), '2028-02-29')).toBe(true)
    })
})

describe('birthdayGreeting', () => {
    it('speaks the club vocabulary and has no offer, no «вас»', () => {
        const fight = birthdayGreeting({ name: 'Самурай', type: 'GRAPPLING' })
        expect(fight).toEqual({
            topic: 'С днём рождения!',
            message: 'Клуб «Самурай» поздравляет с днём рождения! Здоровья, сил и радости от тренировок.',
        })
        const dance = birthdayGreeting({ name: 'Ритм', type: 'DANCE' })
        expect(dance.message).toContain('радости от занятий')
        for (const g of [fight, dance]) {
            expect(g.message).not.toMatch(/вас|скидк|промокод|%/i)
        }
    })
})

describe('loadBirthdayMembers', () => {
    const row = (id: string, dob: string | null, extra: Record<string, unknown> = {}) => ({
        user: {
            id,
            firstname: id,
            lastname: null,
            email: `${id}@x.io`,
            profilePhotoUrl: null,
            dateOfBirth: dob ? d(dob) : null,
            ...extra,
        },
    })

    it('reads active students with a date and keeps today\'s', async () => {
        const findMany = jest
            .fn()
            .mockResolvedValue([row('a', '2000-05-04'), row('b', '2000-05-05'), row('c', null)])
        const out = await loadBirthdayMembers({ workspaceMember: { findMany } } as never, {
            workspaceId: 'w1',
            ymd: '2026-05-04',
        })
        expect(out.map((m) => m.userId)).toEqual(['a'])
        expect(findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'ACTIVE',
            role: { name: 'user' },
            user: { status: 'ACTIVE', dateOfBirth: { not: null } },
        })
    })

    it('narrows to the given user ids', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        await loadBirthdayMembers({ workspaceMember: { findMany } } as never, {
            workspaceId: 'w1',
            ymd: '2026-05-04',
            userIds: ['a'],
        })
        expect(findMany.mock.calls[0][0].where.userId).toEqual({ in: ['a'] })
    })
})
