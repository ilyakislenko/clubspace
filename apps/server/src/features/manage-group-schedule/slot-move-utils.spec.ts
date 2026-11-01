import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    classInstants,
    exceptionOn,
    findMergeTarget,
    findMoveConflict,
    findSplitConflict,
    isOneOffSlot,
    isoDowOfYmd,
    isRestoreMove,
    moveMessage,
    movedReason,
    planExceptionShift,
    planSplit,
    slotHasHistory,
    slotRunsOn,
    splitMessage,
    splitShiftDays,
    validateClassMove,
    weeklyLabel,
} from './slot-move-utils'

// 2026-11-09 is a Monday.
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
const TZ = 'Europe/Moscow' // UTC+3, no DST
const NOW = new Date('2026-11-02T00:00:00Z')

const slot = (extra: Record<string, unknown> = {}) => ({
    id: 'slot-1',
    dayOfWeek: 1,
    startTime: '19:00',
    durationMin: 60,
    effectiveFrom: null as Date | null,
    effectiveUntil: null as Date | null,
    capacity: null as number | null,
    movedFromSlotId: null as string | null,
    movedFromDate: null as Date | null,
    ...extra,
})

const exception = (extra: Record<string, unknown> = {}) => ({
    id: 'exc-1',
    slotId: 'slot-1' as string | null,
    fromDate: d('2026-11-09'),
    untilDate: d('2026-11-09'),
    reason: null as string | null,
    movedToSlotId: null as string | null,
    ...extra,
})

describe('isOneOffSlot / slotRunsOn / isoDowOfYmd', () => {
    it('a one-off runs on exactly one date', () => {
        expect(isOneOffSlot(slot())).toBe(false)
        expect(
            isOneOffSlot(slot({ effectiveFrom: d('2026-11-09'), effectiveUntil: d('2026-11-09') })),
        ).toBe(true)
        expect(
            isOneOffSlot(slot({ effectiveFrom: d('2026-11-09'), effectiveUntil: d('2026-11-16') })),
        ).toBe(false)
    })

    it('checks weekday and effective bounds', () => {
        expect(isoDowOfYmd('2026-11-09')).toBe(1)
        expect(isoDowOfYmd('2026-11-15')).toBe(7)
        expect(slotRunsOn(slot(), '2026-11-09')).toBe(true)
        expect(slotRunsOn(slot(), '2026-11-10')).toBe(false)
        expect(slotRunsOn(slot({ effectiveFrom: d('2026-11-10') }), '2026-11-09')).toBe(false)
        expect(slotRunsOn(slot({ effectiveUntil: d('2026-11-08') }), '2026-11-09')).toBe(false)
    })

    it('finds the exception of the slot or the whole group', () => {
        expect(exceptionOn([exception()], 'slot-1', '2026-11-09')).toBeDefined()
        expect(exceptionOn([exception({ slotId: null })], 'slot-1', '2026-11-09')).toBeDefined()
        expect(exceptionOn([exception({ slotId: 'other' })], 'slot-1', '2026-11-09')).toBeUndefined()
        expect(exceptionOn([exception()], 'slot-1', '2026-11-16')).toBeUndefined()
    })
})

describe('classInstants', () => {
    it('reads the wall clock in the zone', () => {
        const { startAt, endAt } = classInstants('2026-11-09', '19:00', 90, TZ)
        expect(startAt.toISOString()).toBe('2026-11-09T16:00:00.000Z')
        expect(endAt.toISOString()).toBe('2026-11-09T17:30:00.000Z')
    })
})

describe('validateClassMove', () => {
    const base = {
        slot: slot(),
        sessionDate: '2026-11-09',
        newDate: '2026-11-10',
        startTime: '20:00',
        durationMin: 60,
        exceptions: [] as ReturnType<typeof exception>[],
        tz: TZ,
        now: NOW,
        refuseMovedAway: true,
    }
    const message = (over: Partial<typeof base>) => {
        try {
            validateClassMove({ ...base, ...over })
        } catch (e) {
            expect(e).toBeInstanceOf(BadRequestError)
            return (e as BadRequestError).message
        }
        return null
    }

    it('returns both starts for a valid move', () => {
        const out = validateClassMove(base)
        expect(out.originalStart.toISOString()).toBe('2026-11-09T16:00:00.000Z')
        expect(out.newStart.toISOString()).toBe('2026-11-10T17:00:00.000Z')
        expect(out.newEnd.toISOString()).toBe('2026-11-10T18:00:00.000Z')
    })

    it('refuses a date the slot does not run on', () => {
        expect(message({ sessionDate: '2026-11-10' })).toBe(
            'В эту дату занятия по расписанию нет',
        )
    })

    it('refuses a class cancelled by a plain exception', () => {
        expect(message({ exceptions: [exception()] })).toBe(
            'Занятие отменено — сначала верните его',
        )
    })

    it('refuses moving the ghost of a moved class only when asked to', () => {
        const ghost = [exception({ movedToSlotId: 'one-off' })]
        expect(message({ exceptions: ghost })).toBe(
            'Занятие уже перенесено — перетащите его на новом месте',
        )
        expect(message({ exceptions: ghost, refuseMovedAway: false })).toBeNull()
    })

    it('refuses a class that already started', () => {
        expect(message({ now: new Date('2026-11-09T16:00:00Z') })).toBe(
            'Прошедшее занятие нельзя перенести',
        )
    })

    it('refuses a target in the past', () => {
        expect(message({ newDate: '2026-11-01' })).toBe(
            'Нельзя перенести занятие в прошлое',
        )
    })

    it('refuses a class across midnight', () => {
        expect(message({ startTime: '23:30', durationMin: 60 })).toBe(
            'Слот пересекает полночь — разбейте его на два',
        )
    })
})

describe('findMoveConflict', () => {
    const p = {
        sourceSlotId: 'slot-1',
        sessionDate: '2026-11-09',
        newDate: '2026-11-10',
        startTime: '19:30',
        durationMin: 60,
    }
    const tuesday = slot({ id: 'tue', dayOfWeek: 2 })

    it('finds another live class at that time', () => {
        expect(findMoveConflict([slot(), tuesday], [], p)?.id).toBe('tue')
    })

    it('ignores a class cancelled that day, or not in effect', () => {
        expect(
            findMoveConflict([tuesday], [exception({ slotId: 'tue', fromDate: d('2026-11-10'), untilDate: d('2026-11-10') })], p),
        ).toBeUndefined()
        expect(
            findMoveConflict([slot({ id: 'tue', dayOfWeek: 2, effectiveUntil: d('2026-11-03') })], [], p),
        ).toBeUndefined()
    })

    it('ignores the source on its own date but not on another', () => {
        const sameDay = { ...p, newDate: '2026-11-09', startTime: '19:30' }
        expect(findMoveConflict([slot()], [], sameDay)).toBeUndefined()
        const nextWeek = { ...p, newDate: '2026-11-16', startTime: '19:30' }
        expect(findMoveConflict([slot()], [], nextWeek)?.id).toBe('slot-1')
    })
})

describe('isRestoreMove', () => {
    const moved = slot({
        id: 'one-off',
        movedFromSlotId: 'slot-1',
        movedFromDate: d('2026-11-09'),
    })
    const origin = slot()

    it('is a restore only onto the origin date and time', () => {
        const back = { newDate: '2026-11-09', startTime: '19:00', durationMin: 60 }
        expect(isRestoreMove(moved, origin, back)).toBe(true)
        expect(isRestoreMove(moved, origin, { ...back, startTime: '19:30' })).toBe(false)
        expect(isRestoreMove(moved, origin, { ...back, durationMin: 90 })).toBe(false)
        expect(isRestoreMove(moved, origin, { ...back, newDate: '2026-11-16' })).toBe(false)
        expect(isRestoreMove(moved, undefined, back)).toBe(false)
        expect(isRestoreMove(slot({ id: 'x' }), origin, back)).toBe(false)
    })
})

describe('splitShiftDays / slotHasHistory', () => {
    it('allows up to six days either way', () => {
        expect(splitShiftDays('2026-11-09', '2026-11-15')).toBe(6)
        expect(splitShiftDays('2026-11-09', '2026-11-03')).toBe(-6)
        expect(() => splitShiftDays('2026-11-09', '2026-11-16')).toThrow(BadRequestError)
        expect(() => splitShiftDays('2026-11-09', '2026-11-02')).toThrow(BadRequestError)
    })

    it('has history when a class a week earlier is in effect', () => {
        expect(slotHasHistory(null, '2026-11-09')).toBe(true)
        expect(slotHasHistory(d('2026-11-02'), '2026-11-09')).toBe(true)
        expect(slotHasHistory(d('2026-11-03'), '2026-11-09')).toBe(false)
        expect(slotHasHistory(d('2026-11-09'), '2026-11-09')).toBe(false)
    })
})

describe('findMergeTarget', () => {
    // The Monday series that was cut at 2026-11-08 when moved to Tuesdays.
    const ended = slot({ id: 'mon', effectiveUntil: d('2026-11-08') })
    const p = {
        slotId: 'tue',
        newDate: '2026-11-09',
        startTime: '19:00',
        durationMin: 60,
        capacity: null,
    }

    it('continues a series that ended the week before with the same time', () => {
        expect(findMergeTarget([ended, slot({ id: 'tue', dayOfWeek: 2 })], p)?.id).toBe('mon')
    })

    it('needs the same weekday, time, length, capacity and a recent end', () => {
        expect(findMergeTarget([ended], { ...p, startTime: '19:30' })).toBeUndefined()
        expect(findMergeTarget([ended], { ...p, durationMin: 90 })).toBeUndefined()
        expect(findMergeTarget([ended], { ...p, capacity: 10 })).toBeUndefined()
        expect(findMergeTarget([ended], { ...p, newDate: '2026-11-16' })).toBeUndefined()
        expect(findMergeTarget([slot({ id: 'mon' })], p)).toBeUndefined()
        expect(findMergeTarget([ended], { ...p, slotId: 'mon' })).toBeUndefined()
        expect(
            findMergeTarget([slot({ id: 'mon', effectiveUntil: d('2026-11-08'), movedFromSlotId: 'x' })], p),
        ).toBeUndefined()
        // Ends on or after newDate: still running, not mergeable.
        expect(
            findMergeTarget([slot({ id: 'mon', effectiveUntil: d('2026-11-09') })], p),
        ).toBeUndefined()
    })
})

describe('planSplit', () => {
    it('cuts a slot with history: the old keeps up to fromDate−1, the new runs from newDate', () => {
        expect(
            planSplit({
                source: { effectiveFrom: null, effectiveUntil: d('2026-12-28') },
                fromDate: '2026-11-09',
                newDate: '2026-11-10',
                merge: false,
            }),
        ).toEqual({
            mode: 'cut',
            delta: 1,
            history: true,
            targetFrom: '2026-11-10',
            targetUntil: '2026-12-29',
            sourceUntil: '2026-11-08',
            deleteSource: false,
        })
    })

    it('changes a slot without history in place', () => {
        expect(
            planSplit({
                source: { effectiveFrom: d('2026-11-09'), effectiveUntil: null },
                fromDate: '2026-11-09',
                newDate: '2026-11-07',
                merge: false,
            }),
        ).toEqual({
            mode: 'inPlace',
            delta: -2,
            history: false,
            targetFrom: '2026-11-07',
            targetUntil: null,
            sourceUntil: null,
            deleteSource: false,
        })
    })

    it('merges, deleting the source only when nothing is left on it', () => {
        const noHistory = planSplit({
            source: { effectiveFrom: d('2026-11-10'), effectiveUntil: null },
            fromDate: '2026-11-10',
            newDate: '2026-11-09',
            merge: true,
        })
        expect(noHistory).toMatchObject({ mode: 'merge', deleteSource: true, targetUntil: null })
        const withHistory = planSplit({
            source: { effectiveFrom: null, effectiveUntil: null },
            fromDate: '2026-11-10',
            newDate: '2026-11-09',
            merge: true,
        })
        expect(withHistory).toMatchObject({
            mode: 'merge',
            deleteSource: false,
            sourceUntil: '2026-11-09',
        })
    })
})

describe('findSplitConflict', () => {
    const p = {
        excludeIds: ['slot-1'],
        newDate: '2026-11-10',
        targetUntil: null,
        startTime: '19:00',
        durationMin: 60,
    }

    it('finds a slot on the new weekday and time while both are in effect', () => {
        expect(findSplitConflict([slot({ id: 'tue', dayOfWeek: 2 })], p)?.id).toBe('tue')
        expect(
            findSplitConflict([slot({ id: 'tue', dayOfWeek: 2, effectiveUntil: d('2026-11-09') })], p),
        ).toBeUndefined()
        expect(findSplitConflict([slot({ id: 'tue', dayOfWeek: 2 })], { ...p, excludeIds: ['tue'] })).toBeUndefined()
        expect(findSplitConflict([slot({ id: 'tue', dayOfWeek: 2, startTime: '20:00' })], p)).toBeUndefined()
    })
})

describe('planExceptionShift', () => {
    it('moves exceptions from fromDate on, splits one straddling it, leaves older ones', () => {
        const plan = planExceptionShift(
            [
                exception({ id: 'old', fromDate: d('2026-11-02'), untilDate: d('2026-11-02') }),
                exception({ id: 'later', fromDate: d('2026-11-16'), untilDate: d('2026-11-16'), movedToSlotId: 'one-off' }),
                exception({ id: 'span', fromDate: d('2026-11-02'), untilDate: d('2026-11-16'), reason: 'Ремонт' }),
            ],
            '2026-11-09',
            1,
        )
        expect(plan).toEqual({
            repoint: [{ id: 'later', fromDate: '2026-11-17', untilDate: '2026-11-17' }],
            truncate: [{ id: 'span', untilDate: '2026-11-08' }],
            copies: [
                {
                    fromDate: '2026-11-10',
                    untilDate: '2026-11-17',
                    reason: 'Ремонт',
                    movedToSlotId: null,
                },
            ],
        })
    })
})

describe('notification copy', () => {
    it('labels a weekly slot', () => {
        expect(weeklyLabel({ dayOfWeek: 1, startTime: '19:00', durationMin: 90 })).toBe(
            'Пн 19:00–20:30',
        )
    })

    it('words a move, its ghost reason and a split', () => {
        const old = new Date('2026-11-09T16:00:00Z')
        const next = new Date('2026-11-10T17:00:00Z')
        expect(movedReason(next, TZ)).toBe('Перенесено на 10.11 в 20:00')
        expect(moveMessage('Пилон', old, next, TZ)).toBe(
            '«Пилон»: 09.11 в 19:00 → 10.11 в 20:00',
        )
        expect(
            splitMessage(
                'Пилон',
                '2026-11-10',
                { dayOfWeek: 2, startTime: '20:00', durationMin: 60 },
                { dayOfWeek: 1, startTime: '19:00', durationMin: 60 },
            ),
        ).toBe('«Пилон»: с 10.11 — Вт 20:00–21:00 (было Пн 19:00–20:00)')
    })
})
