import { ClubImportCatalog, type CatalogData } from './club-import-catalog'

const plan = (id: string, name: string, directionId: string | null, isActive = true) => ({
    id,
    name,
    directionId,
    price: 1000,
    currency: 'RUB',
    durationDays: 30,
    classCount: 8,
    isActive,
})
const level = (id: string, name: string, order: number, isActive = true) => ({
    id,
    name,
    order,
    maxStripes: 4,
    isActive,
})

const data = (): CatalogData => ({
    gyms: [
        { id: 'g1', name: 'Центральный' },
        { id: 'g2', name: 'Северный' },
    ],
    directions: [
        { id: 'bjj', name: 'БЖЖ' },
        { id: 'mma', name: 'ММА' },
    ],
    groups: [
        { id: 'kids-c-bjj', name: 'Дети', gymId: 'g1', directionId: 'bjj', coachId: 'c' },
        { id: 'kids-c-mma', name: 'Дети', gymId: 'g1', directionId: 'mma', coachId: 'c' },
        { id: 'kids-n', name: 'Дети', gymId: 'g2', directionId: null, coachId: 'c' },
        { id: 'adults', name: 'Взрослые', gymId: 'g1', directionId: null, coachId: 'c' },
    ],
    plans: [
        plan('p-old', '8 занятий', null, false),
        plan('p-club', '8 занятий', null),
        plan('p-bjj', '8 занятий', 'bjj'),
    ],
    ladders: [
        { id: 'adult', name: 'Взрослые пояса', directionId: 'bjj', audience: 'adult', levels: [level('a-white', 'Белый', 0), level('a-blue', 'Синий', 1)] },
        { id: 'kids', name: 'Детские пояса', directionId: 'bjj', audience: 'kids', levels: [level('k-white', 'Белый', 0)] },
        { id: 'thai', name: 'Тайский', directionId: null, audience: null, levels: [level('t-1', 'Первый', 0)] },
    ],
})

describe('ClubImportCatalog', () => {
    const cat = new ClubImportCatalog(data())
    const gym = (n: string) => cat.resolveGym(n)
    const dir = (n: string) => cat.resolveDirection(n)

    it('finds gyms and directions by name regardless of case, «ё» and spaces', () => {
        expect(gym(' центральный ')).toEqual({ existing: { id: 'g1', name: 'Центральный' } })
        expect(dir('бжж')).toEqual({ existing: { id: 'bjj', name: 'БЖЖ' } })
        expect(gym('Южный')).toEqual({ create: { kind: 'gym', name: 'Южный', label: 'Зал «Южный»' } })
    })

    it('narrows a shared group name by gym, then direction', () => {
        expect(cat.resolveGroup('Дети', gym('Центральный'), dir('ММА'))).toMatchObject({ existing: { id: 'kids-c-mma' } })
        expect(cat.resolveGroup('Дети', gym('Северный'), dir('БЖЖ'))).toMatchObject({ existing: { id: 'kids-n' } })
        expect(cat.resolveGroup('Дети', null, null)).toEqual({
            error: 'В клубе несколько групп «Дети» — укажите зал, чтобы выбрать нужную',
        })
        expect(cat.resolveGroup('Взрослые', null, null)).toMatchObject({ existing: { id: 'adults' } })
    })

    it('plans a new group when the gym or direction is new too', () => {
        expect(cat.resolveGroup('Дети', gym('Южный'), dir('Самбо'))).toMatchObject({
            create: { kind: 'group', label: 'Группа «Дети» (Южный, Самбо)' },
        })
        expect(cat.resolveGroup('Утро', null, null)).toMatchObject({ create: { label: 'Группа «Утро»' } })
    })

    it('prefers the direction tariff, then a club-wide active one', () => {
        expect(cat.resolvePlan('8 занятий', dir('БЖЖ'))).toMatchObject({ existing: { id: 'p-bjj' } })
        expect(cat.resolvePlan('8 занятий', dir('ММА'))).toMatchObject({ existing: { id: 'p-club' } })
        expect(cat.resolvePlan('8 занятий', null)).toMatchObject({ existing: { id: 'p-club' } })
        expect(cat.resolvePlan('Безлимит', dir('ММА'))).toMatchObject({ create: { kind: 'plan' } })
    })

    it('settles a belt shared by adult and kids ladders by the row being a child', () => {
        expect(cat.resolveLevel('Белый', dir('БЖЖ'), true)).toMatchObject({ existing: { level: { id: 'k-white' } } })
        expect(cat.resolveLevel('Белый', dir('БЖЖ'), false)).toMatchObject({ existing: { level: { id: 'a-white' } } })
        expect(cat.resolveLevel('Синий', null, true)).toMatchObject({ existing: { level: { id: 'a-blue' } } })
    })

    it('adds a missing belt to the only ladder, or plans a new ladder', () => {
        expect(cat.resolveLevel('Второй', dir('ММА'), false)).toMatchObject({
            create: { kind: 'level', ladder: { id: 'thai' }, label: 'Пояс «Второй» (шкала «Тайский»)' },
        })
        expect(cat.resolveLevel('Жёлтый', dir('Самбо'), false)).toMatchObject({
            create: { kind: 'level', ladder: null, ladderName: 'Пояса · Самбо' },
        })
        expect(cat.resolveLevel('Коричневый', dir('БЖЖ'), false)).toEqual({
            error: expect.stringContaining('шкал несколько'),
        })
    })

    it('refuses a belt that is ambiguous between ladders of one audience', () => {
        const twin = new ClubImportCatalog({
            ...data(),
            ladders: [
                { id: 'l1', name: 'A', directionId: null, audience: null, levels: [level('x1', 'Белый', 0)] },
                { id: 'l2', name: 'B', directionId: null, audience: null, levels: [level('x2', 'Белый', 0)] },
            ],
        })
        expect(twin.resolveLevel('Белый', null, false)).toEqual({
            error: 'Пояс «Белый» есть в нескольких шкалах (A, B) — укажите направление',
        })
    })
})
