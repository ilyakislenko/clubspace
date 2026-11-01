// Static description of the demo club «Арсенал»: gyms, directions, staff,
// groups with their weekly slots, tariffs, rank ladders, courses and names.
// Pure data — demo-club.plan.ts turns it into dated rows.
import { DEMO_EMAIL_DOMAIN, demoAccount, type DemoAccountKey } from './demo-accounts'

export type DirKey = 'bjj' | 'mma' | 'muay' | 'sambo' | 'ofp'
export type GymKey = 'main' | 'south' | 'city'
export type StaffKey =
    | 'owner'
    | 'admin'
    | 'volkov'
    | 'lebedev'
    | 'gadzhiev'
    | 'morozova'
    | 'egorov'
    | 'kovaleva'
export type LadderKey = 'bjj' | 'bjjKids' | 'mma' | 'muay' | 'sambo' | 'ofp'
export type TariffKey =
    | 'trial'
    | 'single'
    | 'bjj8'
    | 'bjj12'
    | 'bjjMma12'
    | 'mma12'
    | 'muay12'
    | 'muayTeen8'
    | 'sambo12'
    | 'kids8'
    | 'ofpUnlim'
    | 'clubUnlim'
    | 'clubUnlim90'
export type PersonKind = 'adult' | 'teen' | 'kid'

export const DIRECTIONS: readonly {
    key: DirKey
    name: string
    color: string
    icon: string
}[] = [
    { key: 'bjj', name: 'БЖЖ', color: '#2563eb', icon: '🥋' },
    { key: 'mma', name: 'ММА', color: '#dc2626', icon: '🥊' },
    { key: 'muay', name: 'Тайский бокс', color: '#f59e0b', icon: '🦵' },
    { key: 'sambo', name: 'Самбо', color: '#16a34a', icon: '🤼' },
    { key: 'ofp', name: 'ОФП', color: '#7c3aed', icon: '💪' },
]

export const GYMS: readonly {
    key: GymKey
    name: string
    address: string
    lat: number
    lng: number
}[] = [
    { key: 'main', name: 'Арсенал — Ленинский', address: 'Москва, Ленинский проспект, 45', lat: 55.7012, lng: 37.5698 },
    { key: 'south', name: 'Арсенал — Южный', address: 'Москва, ул. Академика Янгеля, 12', lat: 55.5958, lng: 37.6001 },
    { key: 'city', name: 'Арсенал — Сити', address: 'Москва, Пресненская наб., 8, стр. 1', lat: 55.7473, lng: 37.5395 },
]

type StaffDef = {
    key: StaffKey
    firstname: string
    lastname: string
    email: string
    role: 'admin' | 'coach'
    account?: DemoAccountKey
    // Руководитель направления (DirectionManager on top of the coach role).
    manages?: DirKey
    description?: string
}

const accountStaff = (
    key: StaffKey,
    account: DemoAccountKey,
    role: 'admin' | 'coach',
    extra: Partial<StaffDef> = {},
): StaffDef => {
    const a = demoAccount(account)
    return {
        key,
        firstname: a.firstname,
        lastname: a.lastname,
        email: a.email,
        role,
        account,
        ...extra,
    }
}

export const STAFF: readonly StaffDef[] = [
    accountStaff('owner', 'owner', 'admin'),
    accountStaff('admin', 'admin', 'admin'),
    accountStaff('volkov', 'directionManager', 'coach', {
        manages: 'bjj',
        description: 'Чёрный пояс БЖЖ, главный тренер направления',
    }),
    accountStaff('lebedev', 'coach', 'coach', {
        description: 'Коричневый пояс БЖЖ, детские группы',
    }),
    {
        key: 'gadzhiev',
        firstname: 'Руслан',
        lastname: 'Гаджиев',
        email: `r.gadzhiev@${DEMO_EMAIL_DOMAIN}`,
        role: 'coach',
        manages: 'mma',
        description: 'Мастер спорта по ММА',
    },
    {
        key: 'morozova',
        firstname: 'Анна',
        lastname: 'Морозова',
        email: `a.morozova@${DEMO_EMAIL_DOMAIN}`,
        role: 'coach',
        manages: 'muay',
        description: 'Чемпионка России по тайскому боксу',
    },
    {
        key: 'egorov',
        firstname: 'Николай',
        lastname: 'Егоров',
        email: `n.egorov@${DEMO_EMAIL_DOMAIN}`,
        role: 'coach',
        manages: 'sambo',
        description: 'МС по самбо',
    },
    {
        key: 'kovaleva',
        firstname: 'Марина',
        lastname: 'Ковалёва',
        email: `m.kovaleva@${DEMO_EMAIL_DOMAIN}`,
        role: 'coach',
        manages: 'ofp',
        description: 'Тренер по функциональной подготовке',
    },
]

export type GroupKey =
    | 'bjjBase'
    | 'bjjAdv'
    | 'bjjKids'
    | 'mmaEvening'
    | 'mmaMorning'
    | 'muayAdult'
    | 'muayTeens'
    | 'samboKids'
    | 'samboAdult'
    | 'ofpMorning'
    | 'ofpEvening'

export type GroupDef = {
    key: GroupKey
    name: string
    dir: DirKey
    gym: GymKey
    ladder: LadderKey
    coach: StaffKey
    assistants: StaffKey[]
    // [ISO weekday 1=Mon..7=Sun, 'HH:MM', minutes]
    slots: [number, string, number][]
    kind: PersonKind
    size: number
}

// The coach account (Лебедев) has a class every day of the week, so «отметить
// посещения» always has something to show on the phone.
export const GROUPS: readonly GroupDef[] = [
    { key: 'bjjBase', name: 'БЖЖ — начинающие', dir: 'bjj', gym: 'main', ladder: 'bjj', coach: 'volkov', assistants: ['lebedev'], slots: [[1, '19:00', 90], [3, '19:00', 90]], kind: 'adult', size: 18 },
    { key: 'bjjAdv', name: 'БЖЖ — продолжающие', dir: 'bjj', gym: 'main', ladder: 'bjj', coach: 'volkov', assistants: ['lebedev'], slots: [[2, '20:00', 90], [4, '20:00', 90], [6, '12:00', 90]], kind: 'adult', size: 15 },
    { key: 'bjjKids', name: 'БЖЖ — дети 7–12', dir: 'bjj', gym: 'south', ladder: 'bjjKids', coach: 'lebedev', assistants: [], slots: [[2, '17:00', 60], [4, '17:00', 60], [6, '10:00', 60]], kind: 'kid', size: 10 },
    { key: 'mmaEvening', name: 'ММА — вечерняя', dir: 'mma', gym: 'main', ladder: 'mma', coach: 'gadzhiev', assistants: [], slots: [[1, '20:45', 90], [3, '20:45', 90], [5, '20:00', 90]], kind: 'adult', size: 15 },
    { key: 'mmaMorning', name: 'ММА — утренняя', dir: 'mma', gym: 'city', ladder: 'mma', coach: 'gadzhiev', assistants: [], slots: [[2, '08:00', 75], [4, '08:00', 75]], kind: 'adult', size: 8 },
    { key: 'muayAdult', name: 'Тайский бокс — взрослые', dir: 'muay', gym: 'south', ladder: 'muay', coach: 'morozova', assistants: [], slots: [[1, '19:30', 90], [3, '19:30', 90], [5, '19:00', 90]], kind: 'adult', size: 15 },
    { key: 'muayTeens', name: 'Тайский бокс — подростки 12–16', dir: 'muay', gym: 'south', ladder: 'muay', coach: 'morozova', assistants: [], slots: [[2, '16:00', 75], [4, '16:00', 75]], kind: 'teen', size: 9 },
    { key: 'samboKids', name: 'Самбо — дети 6–10', dir: 'sambo', gym: 'city', ladder: 'sambo', coach: 'egorov', assistants: ['lebedev'], slots: [[1, '17:00', 60], [3, '17:00', 60], [6, '11:00', 60]], kind: 'kid', size: 8 },
    { key: 'samboAdult', name: 'Самбо — взрослые', dir: 'sambo', gym: 'city', ladder: 'sambo', coach: 'egorov', assistants: [], slots: [[2, '19:30', 90], [4, '19:30', 90]], kind: 'adult', size: 10 },
    { key: 'ofpMorning', name: 'ОФП — функциональный тренинг', dir: 'ofp', gym: 'main', ladder: 'ofp', coach: 'kovaleva', assistants: ['lebedev'], slots: [[3, '08:00', 60], [5, '08:00', 60], [7, '11:00', 60]], kind: 'adult', size: 10 },
    { key: 'ofpEvening', name: 'ОФП — вечер', dir: 'ofp', gym: 'main', ladder: 'ofp', coach: 'kovaleva', assistants: [], slots: [[1, '18:00', 60], [4, '18:00', 60]], kind: 'adult', size: 8 },
]

export type TariffDef = {
    key: TariffKey
    name: string
    description: string
    price: number
    classes: number | null
    days: number
    dirs: DirKey[]
    isFreeTrial?: boolean
}

export const TARIFFS: readonly TariffDef[] = [
    { key: 'trial', name: 'Пробное занятие', description: 'Первая тренировка бесплатно — в любой группе клуба', price: 0, classes: 1, days: 14, dirs: [], isFreeTrial: true },
    { key: 'single', name: 'Разовое занятие', description: 'Одна тренировка в любой группе', price: 1200, classes: 1, days: 14, dirs: [] },
    { key: 'bjj8', name: 'БЖЖ 8', description: '8 тренировок БЖЖ за месяц', price: 5200, classes: 8, days: 30, dirs: ['bjj'] },
    { key: 'bjj12', name: 'БЖЖ 12', description: '12 тренировок БЖЖ за месяц', price: 6500, classes: 12, days: 30, dirs: ['bjj'] },
    { key: 'bjjMma12', name: 'БЖЖ + ММА 12', description: '12 тренировок за месяц в группах БЖЖ и ММА', price: 8900, classes: 12, days: 30, dirs: ['bjj', 'mma'] },
    { key: 'mma12', name: 'ММА 12', description: '12 тренировок ММА за месяц', price: 6500, classes: 12, days: 30, dirs: ['mma'] },
    { key: 'muay12', name: 'Тайский бокс 12', description: '12 тренировок за месяц', price: 6200, classes: 12, days: 30, dirs: ['muay'] },
    { key: 'muayTeen8', name: 'Тайский бокс — подростки 8', description: '8 тренировок за месяц для подростков', price: 4500, classes: 8, days: 30, dirs: ['muay'] },
    { key: 'sambo12', name: 'Самбо 12', description: '12 тренировок самбо за месяц', price: 5500, classes: 12, days: 30, dirs: ['sambo'] },
    { key: 'kids8', name: 'Детские группы 8', description: 'БЖЖ и самбо для детей, 8 тренировок за месяц', price: 4800, classes: 8, days: 30, dirs: ['bjj', 'sambo'] },
    { key: 'ofpUnlim', name: 'ОФП безлимит', description: 'Все тренировки ОФП месяц без ограничений', price: 3900, classes: null, days: 30, dirs: ['ofp'] },
    { key: 'clubUnlim', name: 'Безлимит клуб', description: 'Все направления и все залы, месяц без ограничений', price: 9900, classes: null, days: 30, dirs: [] },
    { key: 'clubUnlim90', name: 'Безлимит клуб — 3 месяца', description: 'Все направления и залы на 3 месяца — выгоднее на 10%', price: 26900, classes: null, days: 90, dirs: [] },
]

export type LadderDef = {
    key: LadderKey
    dir: DirKey
    name: string
    audience: string
    maxStripes: number
    // Days between level-ups for ladders without stripes.
    stepDays: number
    // The coach who awards it.
    coach: StaffKey
    levels: {
        name: string
        color: string
        minVisits?: number
        minWeeks?: number
        requirements?: string
    }[]
}

export const LADDERS: readonly LadderDef[] = [
    {
        key: 'bjj', dir: 'bjj', name: 'Пояса БЖЖ', audience: 'Взрослые', maxStripes: 4, stepDays: 75, coach: 'volkov',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Синий', color: '#2563eb', minVisits: 28, minWeeks: 30, requirements: 'Выходы из всех удержаний, 3 свипа из закрытого гарда, 2 прохода гарда, спарринг 5 раундов' },
            { name: 'Фиолетовый', color: '#7c3aed', minVisits: 150, minWeeks: 78, requirements: 'Своя система гарда, связки атак, участие в турнирах' },
            { name: 'Коричневый', color: '#92400e', minVisits: 150, minWeeks: 78 },
            { name: 'Чёрный', color: '#111827', minVisits: 200, minWeeks: 104 },
        ],
    },
    {
        key: 'bjjKids', dir: 'bjj', name: 'Пояса БЖЖ — дети', audience: 'Дети 7–12', maxStripes: 4, stepDays: 60, coach: 'lebedev',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Серый', color: '#9ca3af', minVisits: 18, minWeeks: 12, requirements: 'Страховка, кувырки, удержание сбоку, выход из маунта' },
            { name: 'Жёлтый', color: '#facc15', minVisits: 30, minWeeks: 16 },
            { name: 'Оранжевый', color: '#f97316', minVisits: 30, minWeeks: 16 },
            { name: 'Зелёный', color: '#16a34a', minVisits: 30, minWeeks: 16 },
        ],
    },
    {
        key: 'mma', dir: 'mma', name: 'Уровни ММА', audience: 'Взрослые', maxStripes: 0, stepDays: 150, coach: 'gadzhiev',
        levels: [
            { name: 'Новичок', color: '#9ca3af' },
            { name: 'Любитель', color: '#f97316', minVisits: 24, minWeeks: 12, requirements: 'Базовая ударная техника, защита от тейкдауна, лёгкий спарринг' },
            { name: 'Продвинутый', color: '#dc2626', minVisits: 40, minWeeks: 26 },
            { name: 'Боец сборной', color: '#111827', minVisits: 60, minWeeks: 52 },
        ],
    },
    {
        key: 'muay', dir: 'muay', name: 'Пражиады', audience: 'Все возрасты', maxStripes: 0, stepDays: 120, coach: 'morozova',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Жёлтый', color: '#facc15', minVisits: 20, minWeeks: 10, requirements: 'Стойка, передвижения, прямые удары, тип' },
            { name: 'Зелёный', color: '#16a34a', minVisits: 30, minWeeks: 16 },
            { name: 'Синий', color: '#2563eb', minVisits: 40, minWeeks: 26 },
            { name: 'Красный', color: '#dc2626', minVisits: 60, minWeeks: 40 },
            { name: 'Чёрный', color: '#111827', minVisits: 80, minWeeks: 52 },
        ],
    },
    {
        key: 'sambo', dir: 'sambo', name: 'Разряды самбо', audience: 'Все возрасты', maxStripes: 0, stepDays: 160, coach: 'egorov',
        levels: [
            { name: 'Без разряда', color: '#9ca3af' },
            { name: '3 разряд', color: '#60a5fa', minVisits: 24, minWeeks: 16, requirements: 'Норматив по броскам и удержаниям, участие в соревнованиях' },
            { name: '2 разряд', color: '#2563eb', minVisits: 40, minWeeks: 26 },
            { name: '1 разряд', color: '#1d4ed8', minVisits: 60, minWeeks: 40 },
            { name: 'КМС', color: '#111827', minVisits: 80, minWeeks: 52 },
        ],
    },
    {
        key: 'ofp', dir: 'ofp', name: 'Уровень подготовки', audience: 'Взрослые', maxStripes: 0, stepDays: 90, coach: 'kovaleva',
        levels: [
            { name: 'Базовый', color: '#a78bfa' },
            { name: 'Средний', color: '#7c3aed', minVisits: 20, minWeeks: 8, requirements: 'Тест: 30 отжиманий, 50 приседаний, планка 2 минуты' },
            { name: 'Продвинутый', color: '#4c1d95', minVisits: 40, minWeeks: 20 },
        ],
    },
]

export type CourseDef = {
    key: string
    title: string
    description: string
    dir: DirKey
    level: string
    // Locked teaser below this level of the ladder (CourseAudience RANK).
    rankGate?: { ladder: LadderKey; order: number }
    chapters: [string, string[]][]
}

export const COURSES: readonly CourseDef[] = [
    {
        key: 'bjj-white-belt', title: 'БЖЖ: база белого пояса', dir: 'bjj', level: 'Белый пояс',
        description: 'Всё, что нужно для первой аттестации: стойка, гард и выходы из-под удержаний',
        chapters: [
            ['Стойка и тейкдауны', ['Двойной проход в ноги', 'Подсечка из клинча', 'Страховка при падении']],
            ['Закрытый гард', ['Свип ножницами', 'Рычаг локтя из гарда', 'Треугольник']],
            ['Выходы из-под удержаний', ['Выход из маунта «мостом»', 'Выход из бокового удержания']],
        ],
    },
    {
        key: 'bjj-blue-belt', title: 'БЖЖ: синий пояс — открытый гард', dir: 'bjj', level: 'Синий пояс',
        description: 'Де ла Рива, паук и лассо — программа для синих поясов',
        rankGate: { ladder: 'bjj', order: 1 },
        chapters: [
            ['Де ла Рива', ['Вход в де ла Риву', 'Свип берембоу']],
            ['Паук и лассо', ['Контроль рукавов', 'Свип из лассо']],
        ],
    },
    {
        key: 'mma-striking', title: 'ММА: ударная техника и переходы', dir: 'mma', level: 'Все уровни',
        description: 'Связки ударов и переходы в борьбу',
        chapters: [
            ['Удары руками', ['Джеб — кросс', 'Апперкот в движении']],
            ['Переходы в борьбу', ['Проход в ноги после двойки', 'Защита от тейкдауна у сетки']],
        ],
    },
    {
        key: 'muay-clinch', title: 'Тайский бокс: клинч и колени', dir: 'muay', level: 'Все уровни',
        description: 'Работа в клинче — визитная карточка тайского бокса',
        chapters: [
            ['Клинч', ['Захват шеи', 'Выведение из равновесия']],
            ['Колени', ['Прямое колено', 'Колено в корпус из клинча']],
        ],
    },
    {
        key: 'sambo-throws', title: 'Самбо: броски и болевые на ноги', dir: 'sambo', level: 'Все уровни',
        description: 'Базовые броски и болевые приёмы спортивного самбо',
        chapters: [
            ['Броски', ['Задняя подножка', 'Бросок через бедро']],
            ['Болевые', ['Ущемление ахиллова сухожилия', 'Узел ноги']],
        ],
    },
    {
        key: 'ofp-mobility', title: 'ОФП: мобильность и восстановление', dir: 'ofp', level: 'Все уровни',
        description: 'Разминка и растяжка, которые можно делать дома',
        chapters: [
            ['Разминка', ['Суставная разминка за 7 минут']],
            ['Растяжка', ['Тазобедренные суставы', 'Грудной отдел позвоночника']],
        ],
    },
]

export const MALE_NAMES = [
    'Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл', 'Михаил',
    'Никита', 'Матвей', 'Роман', 'Егор', 'Арсений', 'Иван', 'Денис', 'Евгений', 'Тимофей', 'Владислав',
    'Игорь', 'Павел', 'Руслан', 'Марк', 'Глеб', 'Константин', 'Олег', 'Виктор', 'Антон', 'Ярослав',
]
export const FEMALE_NAMES = [
    'Анна', 'Мария', 'Елена', 'Дарья', 'Алиса', 'Полина', 'Виктория', 'Екатерина', 'Софья', 'Анастасия',
    'Ксения', 'Валерия', 'Вероника', 'Арина', 'Ольга', 'Татьяна', 'Юлия', 'Наталья', 'Кристина', 'Ирина',
]
// Male forms; the female form adds «а» (all end in -ов/-ев/-ёв/-ин).
export const SURNAMES = [
    'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Михайлов', 'Новиков', 'Фёдоров', 'Алексеев', 'Семёнов',
    'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьёв',
    'Борисов', 'Яковлев', 'Григорьев', 'Романов', 'Воробьёв', 'Сергеев', 'Кузьмин', 'Фролов', 'Александров', 'Дмитриев',
    'Королёв', 'Гусев', 'Киселёв', 'Ильин', 'Максимов', 'Поляков', 'Сорокин', 'Виноградов', 'Белов', 'Медведев',
    'Антонов', 'Тарасов', 'Жуков', 'Баранов', 'Филиппов', 'Комаров', 'Давыдов', 'Беляев', 'Герасимов', 'Богданов',
    'Осипов', 'Сидоров', 'Матвеев', 'Титов', 'Марков', 'Миронов', 'Крылов', 'Куликов', 'Карпов', 'Власов',
    'Мельников', 'Денисов', 'Гаврилов', 'Тихонов', 'Казаков', 'Афанасьев', 'Данилов', 'Савельев', 'Тимофеев', 'Фомин',
    'Чернов', 'Абрамов', 'Мартынов', 'Ефимов', 'Федотов', 'Щербаков', 'Назаров', 'Калинин', 'Исаев', 'Быков',
]

const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
    ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export const translit = (text: string): string =>
    text
        .toLowerCase()
        .split('')
        .map((c) => TRANSLIT[c] ?? c)
        .join('')

export const femaleSurname = (male: string): string => `${male}а`
