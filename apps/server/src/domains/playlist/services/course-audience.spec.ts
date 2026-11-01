import {
    type AudienceRow,
    buildCourseAudienceWhere,
    computeProgressionLocks,
    type CourseViewer,
    describeAudience,
    courseAudienceMemberWhere,
    evaluateCourseAudience,
    hidingAudienceIds,
    STAFF_VIEWER,
} from './course-audience'

const group = (id: string | null, name = 'Дети'): AudienceRow => ({
    kind: 'GROUP',
    groupId: id,
    rankLevelId: null,
    planId: null,
    directionId: null,
    group: id ? { name } : null,
    direction: null,
    rankLevel: null,
    plan: null,
})

const rank = (
    id: string | null,
    order: number,
    name = 'Синий пояс',
    ladderId = 'ladder-adult',
): AudienceRow => ({
    kind: 'RANK',
    groupId: null,
    rankLevelId: id,
    planId: null,
    directionId: null,
    group: null,
    direction: null,
    rankLevel: id
        ? { name, order, ladderId, ladder: { name: 'Взрослые' } }
        : null,
    plan: null,
})

const plan = (id: string | null, name = 'Безлимит'): AudienceRow => ({
    kind: 'PLAN',
    groupId: null,
    rankLevelId: null,
    planId: id,
    directionId: null,
    group: null,
    direction: null,
    rankLevel: null,
    plan: id ? { name } : null,
})

const direction = (id: string | null, name = 'БЖЖ'): AudienceRow => ({
    kind: 'DIRECTION',
    groupId: null,
    rankLevelId: null,
    planId: null,
    directionId: id,
    group: null,
    direction: id ? { name } : null,
    rankLevel: null,
    plan: null,
})

const student = (o: Partial<Omit<CourseViewer, 'isStaff'>> = {}): CourseViewer => ({
    isStaff: false,
    groupIds: o.groupIds ?? new Set(),
    directionIds: o.directionIds ?? new Set(),
    planIds: o.planIds ?? new Set(),
    rankOrderByLadder: o.rankOrderByLadder ?? new Map(),
})

describe('evaluateCourseAudience', () => {
    it('opens a course without audience rows to everyone', () => {
        expect(evaluateCourseAudience([], student())).toEqual({
            hidden: false,
            lock: null,
        })
    })

    it('lets staff through every rule', () => {
        const rows = [group('g1'), rank('l2', 2), plan('p1')]
        expect(evaluateCourseAudience(rows, STAFF_VIEWER)).toEqual({
            hidden: false,
            lock: null,
        })
    })

    it('hides a group course from students outside the groups', () => {
        const verdict = evaluateCourseAudience([group('g1')], student())
        expect(verdict).toEqual({
            hidden: true,
            lock: { kind: 'GROUP', reason: 'Для группы «Дети»' },
        })
    })

    it('opens a group course to a member of any of its groups', () => {
        const rows = [group('g1'), group('g2', 'Соревновательная')]
        expect(
            evaluateCourseAudience(rows, student({ groupIds: new Set(['g2']) })),
        ).toEqual({ hidden: false, lock: null })
    })

    it('keeps a course closed when its only group was deleted', () => {
        const verdict = evaluateCourseAudience([group(null)], student())
        expect(verdict.hidden).toBe(true)
        expect(verdict.lock?.reason).toBe('Для отдельных групп')
    })

    it('hides a direction course from students outside the directions', () => {
        expect(evaluateCourseAudience([direction('d1')], student())).toEqual({
            hidden: true,
            lock: { kind: 'DIRECTION', reason: 'Для направления «БЖЖ»' },
        })
        expect(
            evaluateCourseAudience(
                [direction('d1'), direction('d2', 'ММА')],
                student({ directionIds: new Set(['d3']) }),
            ).lock?.reason,
        ).toBe('Для направлений «БЖЖ», «ММА»')
    })

    it('opens a direction course to a member of any of its directions', () => {
        const rows = [direction('d1'), direction('d2', 'ММА')]
        expect(
            evaluateCourseAudience(rows, student({ directionIds: new Set(['d2']) })),
        ).toEqual({ hidden: false, lock: null })
    })

    it('keeps a course closed when its only direction was deleted', () => {
        const verdict = evaluateCourseAudience([direction(null)], student())
        expect(verdict.hidden).toBe(true)
        expect(verdict.lock?.reason).toBe('Для отдельных направлений')
    })

    it('ANDs group and direction: both must match', () => {
        const rows = [group('g1'), direction('d1')]
        expect(
            evaluateCourseAudience(rows, student({ groupIds: new Set(['g1']) }))
                .lock?.kind,
        ).toBe('DIRECTION')
        expect(
            evaluateCourseAudience(rows, student({ directionIds: new Set(['d1']) }))
                .lock?.kind,
        ).toBe('GROUP')
        expect(
            evaluateCourseAudience(
                rows,
                student({
                    groupIds: new Set(['g1']),
                    directionIds: new Set(['d1']),
                }),
            ),
        ).toEqual({ hidden: false, lock: null })
    })

    it('teases a rank course below the minimum level with the reason', () => {
        const verdict = evaluateCourseAudience(
            [rank('l2', 2)],
            student({ rankOrderByLadder: new Map([['ladder-adult', 1]]) }),
        )
        expect(verdict).toEqual({
            hidden: false,
            lock: { kind: 'RANK', reason: 'Доступно с уровня «Синий пояс»' },
        })
    })

    it('opens a rank course at or above the minimum level', () => {
        const rows = [rank('l2', 2)]
        for (const order of [2, 3]) {
            expect(
                evaluateCourseAudience(
                    rows,
                    student({ rankOrderByLadder: new Map([['ladder-adult', order]]) }),
                ).lock,
            ).toBeNull()
        }
    })

    it('ignores a level on another ladder', () => {
        const verdict = evaluateCourseAudience(
            [rank('l2', 2)],
            student({ rankOrderByLadder: new Map([['ladder-kids', 9]]) }),
        )
        expect(verdict.lock?.kind).toBe('RANK')
    })

    it('accepts the minimum on any of several ladders', () => {
        const rows = [
            rank('l2', 2),
            rank('k5', 5, 'Зелёный пояс', 'ladder-kids'),
        ]
        expect(evaluateCourseAudience(rows, student()).lock?.reason).toBe(
            'Доступно с уровня «Синий пояс» или «Зелёный пояс»',
        )
        expect(
            evaluateCourseAudience(
                rows,
                student({ rankOrderByLadder: new Map([['ladder-kids', 5]]) }),
            ).lock,
        ).toBeNull()
    })

    it('teases a plan course to students without that abonement', () => {
        expect(evaluateCourseAudience([plan('p1')], student()).lock).toEqual({
            kind: 'PLAN',
            reason: 'Доступно по абонементу «Безлимит»',
        })
        expect(
            evaluateCourseAudience(
                [plan('p1'), plan('p2', 'Премиум')],
                student(),
            ).lock?.reason,
        ).toBe('Доступно по абонементам «Безлимит», «Премиум»')
        expect(
            evaluateCourseAudience(
                [plan('p1')],
                student({ planIds: new Set(['p1']) }),
            ).lock,
        ).toBeNull()
    })

    it('ANDs the kinds: group passes but rank still locks, rank before plan', () => {
        const rows = [group('g1'), rank('l2', 2), plan('p1')]
        const inGroup = student({ groupIds: new Set(['g1']) })
        expect(evaluateCourseAudience(rows, inGroup).lock?.kind).toBe('RANK')
        const ranked = student({
            groupIds: new Set(['g1']),
            rankOrderByLadder: new Map([['ladder-adult', 2]]),
        })
        expect(evaluateCourseAudience(rows, ranked).lock?.kind).toBe('PLAN')
    })

    it('words deleted levels and plans neutrally', () => {
        expect(evaluateCourseAudience([rank(null, 0)], student()).lock?.reason).toBe(
            'Доступно с определённого уровня',
        )
        expect(evaluateCourseAudience([plan(null)], student()).lock?.reason).toBe(
            'Доступно по отдельным абонементам',
        )
    })
})

describe('buildCourseAudienceWhere', () => {
    it('adds nothing for staff', () => {
        expect(buildCourseAudienceWhere(STAFF_VIEWER)).toEqual([])
    })

    it('keeps courses without groups/directions or in one of the viewer’s', () => {
        expect(
            buildCourseAudienceWhere(
                student({
                    groupIds: new Set(['g1']),
                    directionIds: new Set(['d1']),
                }),
            ),
        ).toEqual([
            {
                OR: [
                    { audience: { none: { kind: 'GROUP' } } },
                    { audience: { some: { kind: 'GROUP', groupId: { in: ['g1'] } } } },
                ],
            },
            {
                OR: [
                    { audience: { none: { kind: 'DIRECTION' } } },
                    {
                        audience: {
                            some: { kind: 'DIRECTION', directionId: { in: ['d1'] } },
                        },
                    },
                ],
            },
        ])
    })

    it('matches no direction course for a viewer in no direction', () => {
        const [, dir] = buildCourseAudienceWhere(student())
        expect(dir.OR[1]).toEqual({
            audience: { some: { kind: 'DIRECTION', directionId: { in: [] } } },
        })
    })
})

describe('describeAudience', () => {
    it('is null for a course open to the club', () => {
        expect(describeAudience([])).toBeNull()
    })

    it('joins every restriction for staff screens', () => {
        expect(
            describeAudience([
                group('g1'),
                group('g2', 'Взрослые'),
                direction('d1'),
                rank('l2', 2),
                plan('p1'),
            ]),
        ).toBe(
            'Для групп «Дети», «Взрослые» · Для направления «БЖЖ» · Доступно с уровня «Синий пояс» · Доступно по абонементу «Безлимит»',
        )
    })
})

describe('computeProgressionLocks', () => {
    const lessons = [
        { videoId: 'a', isOptional: false },
        { videoId: 'b', isOptional: true },
        { videoId: 'c', isOptional: false },
        { videoId: 'd', isOptional: false },
    ]

    it('opens only the first lesson for a fresh student', () => {
        expect([...computeProgressionLocks(lessons, new Set())]).toEqual([
            'b',
            'c',
            'd',
        ])
    })

    it('skips optional lessons when deciding what the next one needs', () => {
        // a done → b (optional) and c open; c not done → d locked.
        expect([...computeProgressionLocks(lessons, new Set(['a']))]).toEqual([
            'd',
        ])
        expect(computeProgressionLocks(lessons, new Set(['a', 'c'])).size).toBe(0)
    })

    it('unlocks a lesson from the previous required one alone', () => {
        // Watched c before the course went sequential: d opens, b/c don't.
        expect([...computeProgressionLocks(lessons, new Set(['c']))]).toEqual([
            'b',
            'c',
        ])
    })
})

describe('courseAudienceMemberWhere', () => {
    const staff = { role: { name: { in: ['admin', 'head_coach', 'coach'] } } }
    const inGroups = (ids: string[]) => ({
        user: { groupMemberships: { some: { groupId: { in: ids } } } },
    })
    const ofDirection = (id: string) => ({
        user: {
            OR: [
                { groupMemberships: { some: { group: { directionId: id } } } },
                { coachAssignments: { some: { group: { directionId: id } } } },
            ],
        },
    })

    it('is undefined when any live course is open to the club', () => {
        expect(
            courseAudienceMemberWhere([
                { groupIds: ['g1'], directionIds: [] },
                { groupIds: [], directionIds: [] },
            ]),
        ).toBeUndefined()
    })

    it('limits to staff and members of the groups, dropping deleted ones', () => {
        expect(
            courseAudienceMemberWhere([
                { groupIds: ['g1', null], directionIds: [] },
                { groupIds: ['g1', 'g2'], directionIds: [] },
            ]),
        ).toEqual({
            OR: [staff, inGroups(['g1']), inGroups(['g1', 'g2'])],
        })
    })

    it('targets members of a direction course’s directions', () => {
        expect(
            courseAudienceMemberWhere([
                { groupIds: [], directionIds: ['d1', 'd2', null] },
            ]),
        ).toEqual({
            OR: [staff, { OR: [ofDirection('d1'), ofDirection('d2')] }],
        })
    })

    it('ANDs groups and directions within a course, ORs across courses', () => {
        expect(
            courseAudienceMemberWhere([
                { groupIds: ['g1'], directionIds: ['d1'] },
                { groupIds: [], directionIds: ['d2'] },
                { groupIds: [], directionIds: ['d2'] },
            ]),
        ).toEqual({
            OR: [
                staff,
                { AND: [inGroups(['g1']), { OR: [ofDirection('d1')] }] },
                { OR: [ofDirection('d2')] },
            ],
        })
    })

    it('reaches only staff when every target was deleted', () => {
        expect(
            courseAudienceMemberWhere([{ groupIds: [], directionIds: [null] }]),
        ).toEqual({ OR: [staff, { OR: [] }] })
    })
})

describe('hidingAudienceIds', () => {
    it('splits a course’s GROUP and DIRECTION rows', () => {
        expect(
            hidingAudienceIds([
                { kind: 'GROUP', groupId: 'g1', directionId: null },
                { kind: 'DIRECTION', groupId: null, directionId: 'd1' },
                { kind: 'DIRECTION', groupId: null, directionId: null },
            ]),
        ).toEqual({ groupIds: ['g1'], directionIds: ['d1', null] })
    })
})
