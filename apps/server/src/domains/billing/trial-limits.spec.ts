import {
    dueTrialReminder,
    estimateTrialCost,
    fitsTrialStorage,
    isTrialModule,
    parseTrialReminderDays,
    trialCapsApply,
    trialReminderAt,
    trialStorageMessage,
    trialViewingMessage,
    videoTrialCapsApply,
    withinTrialViewing,
} from './trial-limits'

const GB = 1024 ** 3
const DAY = 86_400_000
const NOW = new Date('2026-11-10T12:00:00.000Z')

describe('trial limits', () => {
    it('the trial includes video and online payments, never the branded app', () => {
        expect(isTrialModule('VIDEO')).toBe(true)
        expect(isTrialModule('ONLINE_PAYMENTS')).toBe(true)
        expect(isTrialModule('BRANDED_APP')).toBe(false)
    })

    it('caps hold on an unpaid trial only', () => {
        const trial = { status: 'TRIAL' as const, currentPeriodEnd: null }
        expect(trialCapsApply(trial, NOW, true)).toBe(true)
        expect(trialCapsApply(null, NOW, true)).toBe(true)
        expect(trialCapsApply(trial, NOW, false)).toBe(false)
        // Paid early during the trial: lifted.
        expect(
            trialCapsApply({ ...trial, currentPeriodEnd: new Date(NOW.getTime() + DAY) }, NOW, true),
        ).toBe(false)
        expect(trialCapsApply({ status: 'ACTIVE', currentPeriodEnd: null }, NOW, true)).toBe(false)
        // VIDEO granted free (COMP) or bought: lifted.
        expect(videoTrialCapsApply(trial, 'TRIAL', NOW, true)).toBe(true)
        expect(videoTrialCapsApply(trial, 'COMP', NOW, true)).toBe(false)
        expect(videoTrialCapsApply(trial, 'PAID', NOW, true)).toBe(false)
    })

    it('storage: an upload must fit next to what is stored; an undeclared one until the cap', () => {
        expect(fitsTrialStorage(1.5 * GB, 0.5 * GB, 2)).toBe(true)
        expect(fitsTrialStorage(1.5 * GB, 0.5 * GB + 1, 2)).toBe(false)
        expect(fitsTrialStorage(1.9 * GB, undefined, 2)).toBe(true)
        expect(fitsTrialStorage(2 * GB, undefined, 2)).toBe(false)
        expect(trialStorageMessage(2, 1.9 * GB)).toBe(
            'В пробном периоде можно хранить до 2 ГБ видео, загружено 1,9 ГБ — этот файл не помещается. Оплатите тариф, чтобы снять ограничение.',
        )
    })

    it('viewing: refused once the monthly hours are watched', () => {
        expect(withinTrialViewing(10 * 3600 - 1, 10)).toBe(true)
        expect(withinTrialViewing(10 * 3600, 10)).toBe(false)
        expect(trialViewingMessage(10)).toContain('Оплатите тариф, чтобы снять ограничение')
    })

    it('reminder days parse, dedupe and sort; out of range stops the boot', () => {
        expect(parseTrialReminderDays('28, 23,23', 30)).toEqual([23, 28])
        expect(parseTrialReminderDays('', 30)).toEqual([])
        expect(() => parseTrialReminderDays('30', 30)).toThrow('PLATFORM_TRIAL_REMINDER_DAYS')
        expect(() => parseTrialReminderDays('x', 30)).toThrow('PLATFORM_TRIAL_REMINDER_DAYS')
    })

    it('day N of a T-day trial is T - N days before its end; only the latest passed day is due', () => {
        const end = new Date(NOW.getTime() + 7 * DAY)
        expect(trialReminderAt(end, 23, 30)).toEqual(NOW)
        expect(dueTrialReminder(end, [23, 28], 30, new Date(NOW.getTime() - 1))).toBeNull()
        expect(dueTrialReminder(end, [23, 28], 30, NOW)).toEqual({ day: 23, passed: [23] })
        expect(dueTrialReminder(end, [23, 28], 30, new Date(NOW.getTime() + 5 * DAY))).toEqual({
            day: 28,
            passed: [23, 28],
        })
        expect(dueTrialReminder(end, [23, 28], 30, end)).toBeNull()
    })

    it('estimates the trial cost in whole rubles', () => {
        expect(
            estimateTrialCost(
                { activeMembers: 30, emailsSent: 50, storageBytes: 2 * GB, viewedSeconds: 10 * 3600, days: 30 },
                { storageGbMonth: 3, viewHour: 2, email: 0.1, activeMemberMonth: 1 },
            ),
        ).toBe(6 + 20 + 5 + 30)
    })
})
