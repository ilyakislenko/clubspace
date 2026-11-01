// Static description of the demo club «ACADEMY»: branches, directions,
// coaches, groups with their weekly slots, tariffs, rank ladders, courses and
// names. Branches, groups, schedule and coaches mirror the real network
// (Томск + Северск); no real phone numbers. Pure data — demo-club.plan.ts turns
// it into dated rows.
import { DEMO_EMAIL_DOMAIN, demoAccount, type DemoAccountKey } from './demo-accounts'

export type DirKey = 'bjj' | 'mma' | 'muay'
export type GymKey =
    | 'dvorets'
    | 'yupiter'
    | 'energetik'
    | 'shariki'
    | 'rys'
    | 'yuzhnye'
    | 'vershina'
    | 'muromets'
    | 'sibiryak'
    | 'seversk'
export type StaffKey =
    | 'owner'
    | 'admin'
    | 'savelyev'
    | 'reshetyuk'
    | 'starokorov'
    | 'vlasov'
    | 'gizatulin'
    | 'shekunov'
    | 'mishenin'
    | 'shadrina'
    | 'lubenikova'
    | 'chertovskikh'
export type LadderKey = 'bjj' | 'bjjKids' | 'mma' | 'muay'
export type TariffKey =
    | 'trial'
    | 'single'
    | 'pack8'
    | 'pack12'
    | 'unlim'
    | 'muay12'
    | 'bjjMma12'
export type PersonKind = 'adult' | 'kid'

export const DIRECTIONS: readonly {
    key: DirKey
    name: string
    color: string
    icon: string
}[] = [
    { key: 'bjj', name: 'БЖЖ', color: '#2563eb', icon: '🥋' },
    { key: 'mma', name: 'ММА', color: '#dc2626', icon: '🥊' },
    { key: 'muay', name: 'Тайский бокс', color: '#f59e0b', icon: '🦵' },
]

export const GYMS: readonly { key: GymKey; name: string; short: string; address: string }[] = [
    { key: 'dvorets', name: 'СК «Дворец спорта»', short: 'Дворец спорта', address: 'Томск, ул. Красноармейская, 126' },
    { key: 'yupiter', name: 'СК «Юпитер»', short: 'Юпитер', address: 'Томск, ул. Смирнова, 48б' },
    { key: 'energetik', name: 'СК «Энергетик»', short: 'Энергетик', address: 'Томск, ул. Новгородская, 22' },
    { key: 'shariki', name: 'РК «Шарики»', short: 'Шарики', address: 'Томск, ул. Северный городок, 48/1' },
    { key: 'rys', name: 'СК «Белая рысь»', short: 'Белая рысь', address: 'Томск, ул. Ленина, 84' },
    { key: 'yuzhnye', name: 'мкр. Южные Ворота', short: 'Южные Ворота', address: 'Томск, мкр. Южные Ворота, ул. Тихая, 103' },
    { key: 'vershina', name: 'ТЦ «Вершина» (Зелёные Горки)', short: 'Вершина', address: 'Томск, ул. Ивановского, 22а' },
    { key: 'muromets', name: 'СК «Муромец»', short: 'Муромец', address: 'Томск, пер. Карский, 29' },
    { key: 'sibiryak', name: 'СК «Сибиряк»', short: 'Сибиряк', address: 'Томск, ул. Сибирская, 64/1' },
    { key: 'seversk', name: 'СК «Центр тайского бокса»', short: 'Северск', address: 'Северск, ул. Транспортная, 32' },
]

type StaffDef = {
    key: StaffKey
    // null when only the surname is known.
    firstname: string | null
    lastname: string
    email: string
    role: 'admin' | 'head_coach' | 'coach'
    account?: DemoAccountKey
    // Руководитель направления (a DirectionManager seat on the coach role).
    manages?: DirKey
    description?: string
}

const accountStaff = (
    key: StaffKey,
    account: DemoAccountKey,
    role: StaffDef['role'],
    extra: Partial<StaffDef> = {},
): StaffDef => {
    const a = demoAccount(account)
    return { key, firstname: a.firstname, lastname: a.lastname, email: a.email, role, account, ...extra }
}

const coach = (key: StaffKey, firstname: string | null, lastname: string, extra: Partial<StaffDef> = {}): StaffDef => ({
    key,
    firstname,
    lastname,
    email: `${key}@${DEMO_EMAIL_DOMAIN}`,
    role: 'coach',
    ...extra,
})

// Савельев Роман is the head coach: he writes every direction (тайский бокс
// included) without a manager seat, which only plain coaches hold.
export const STAFF: readonly StaffDef[] = [
    accountStaff('owner', 'owner', 'admin'),
    accountStaff('admin', 'admin', 'admin'),
    accountStaff('savelyev', 'coach', 'head_coach', { description: 'Главный тренер: BJJ, ММА, тайский бокс' }),
    accountStaff('reshetyuk', 'directionManager', 'coach', { manages: 'bjj', description: 'Руководитель направления БЖЖ' }),
    coach('starokorov', 'И.', 'Старокоров', { manages: 'mma', description: 'Руководитель направления ММА' }),
    coach('vlasov', null, 'Власов', { description: 'Детские группы' }),
    coach('gizatulin', 'А.', 'Гизатулин', { description: 'Детские группы' }),
    coach('shekunov', 'И.', 'Шекунов', { description: 'Детские группы' }),
    coach('mishenin', 'Т.', 'Мишенин', { description: 'Детские группы' }),
    coach('shadrina', 'Е.', 'Шадрина', { description: 'Детские группы' }),
    coach('lubenikova', 'А.', 'Лубеникова', { description: 'Детские группы' }),
    coach('chertovskikh', 'Роман', 'Чертовских', { description: 'BJJ, взрослые' }),
]

export type GroupKey =
    | 'dvBjjEvening'
    | 'dvBjjMorning'
    | 'dvKidsSenior'
    | 'dvKidsJunior'
    | 'dvMma'
    | 'yuKidsJunior'
    | 'yuKidsSenior'
    | 'yuBjj'
    | 'enKidsSenior'
    | 'shBjjEvening'
    | 'shBjjMorning'
    | 'rysMma'
    | 'rysKidsSenior'
    | 'yvKidsSenior'
    | 'yvKidsJunior'
    | 'veKidsJunior'
    | 'veKidsSenior'
    | 'muKidsSenior'
    | 'sbBjj'
    | 'svMuay'

export type GroupDef = {
    key: GroupKey
    name: string
    dir: DirKey
    gym: GymKey
    ladder: LadderKey
    coach: StaffKey
    // [ISO weekday 1=Mon..7=Sun, 'HH:MM', minutes]
    slots: [number, string, number][]
    kind: PersonKind
    // Children's ages, years.
    ages?: [number, number]
    size: number
}

const SENIOR: [number, number] = [10, 13]
const JUNIOR: [number, number] = [5, 9]
// The same start time and length on several weekdays.
const weekly = (days: number[], time: string, min: number): [number, string, number][] =>
    days.map((d) => [d, time, min])

// The head coach account (Савельев) has a class every day of the week, so
// «отметить посещения» always has something to show on the phone.
export const GROUPS: readonly GroupDef[] = [
    { key: 'dvBjjEvening', name: 'BJJ Взрослые (Вечер)', dir: 'bjj', gym: 'dvorets', ladder: 'bjj', coach: 'savelyev', slots: weekly([1, 3, 5], '20:00', 90), kind: 'adult', size: 30 },
    { key: 'dvBjjMorning', name: 'BJJ Взрослые (Утро)', dir: 'bjj', gym: 'dvorets', ladder: 'bjj', coach: 'savelyev', slots: weekly([2, 4], '10:30', 90), kind: 'adult', size: 14 },
    { key: 'dvKidsSenior', name: 'BJJ Старшие дети', dir: 'bjj', gym: 'dvorets', ladder: 'bjjKids', coach: 'savelyev', slots: [[2, '09:30', 60], [2, '17:00', 60], [4, '09:30', 60], [4, '17:00', 60], [6, '14:00', 60]], kind: 'kid', ages: SENIOR, size: 20 },
    { key: 'dvKidsJunior', name: 'BJJ Младшие дети', dir: 'bjj', gym: 'dvorets', ladder: 'bjjKids', coach: 'savelyev', slots: [[4, '18:00', 60], [7, '12:00', 60]], kind: 'kid', ages: JUNIOR, size: 12 },
    { key: 'dvMma', name: 'ММА Взрослые', dir: 'mma', gym: 'dvorets', ladder: 'mma', coach: 'savelyev', slots: [[2, '20:00', 90], [4, '20:00', 90], [6, '15:00', 90]], kind: 'adult', size: 22 },
    { key: 'yuKidsJunior', name: 'Дети Младшие', dir: 'bjj', gym: 'yupiter', ladder: 'bjjKids', coach: 'vlasov', slots: weekly([1, 3], '18:30', 60), kind: 'kid', ages: JUNIOR, size: 12 },
    { key: 'yuKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'yupiter', ladder: 'bjjKids', coach: 'gizatulin', slots: weekly([1, 3, 5], '18:30', 60), kind: 'kid', ages: SENIOR, size: 14 },
    { key: 'yuBjj', name: 'BJJ Взрослые', dir: 'bjj', gym: 'yupiter', ladder: 'bjj', coach: 'reshetyuk', slots: weekly([1, 3, 5], '19:30', 90), kind: 'adult', size: 22 },
    { key: 'enKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'energetik', ladder: 'bjjKids', coach: 'shekunov', slots: [[2, '18:00', 60], [6, '13:00', 60]], kind: 'kid', ages: SENIOR, size: 10 },
    { key: 'shBjjEvening', name: 'BJJ Взрослые (Вечер)', dir: 'bjj', gym: 'shariki', ladder: 'bjj', coach: 'reshetyuk', slots: weekly([2, 4, 6], '19:30', 90), kind: 'adult', size: 22 },
    { key: 'shBjjMorning', name: 'BJJ Утро', dir: 'bjj', gym: 'shariki', ladder: 'bjj', coach: 'reshetyuk', slots: weekly([2, 4], '10:00', 60), kind: 'adult', size: 10 },
    { key: 'rysMma', name: 'ММА Взрослые', dir: 'mma', gym: 'rys', ladder: 'mma', coach: 'starokorov', slots: weekly([1, 3, 5], '19:30', 90), kind: 'adult', size: 18 },
    { key: 'rysKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'rys', ladder: 'bjjKids', coach: 'shekunov', slots: weekly([1, 3, 5], '18:30', 60), kind: 'kid', ages: SENIOR, size: 14 },
    { key: 'yvKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'yuzhnye', ladder: 'bjjKids', coach: 'mishenin', slots: weekly([2, 4], '18:00', 60), kind: 'kid', ages: SENIOR, size: 12 },
    { key: 'yvKidsJunior', name: 'Дети Младшие', dir: 'bjj', gym: 'yuzhnye', ladder: 'bjjKids', coach: 'shadrina', slots: [[2, '18:00', 60], [6, '11:00', 60]], kind: 'kid', ages: JUNIOR, size: 10 },
    { key: 'veKidsJunior', name: 'Дети Младшие', dir: 'bjj', gym: 'vershina', ladder: 'bjjKids', coach: 'lubenikova', slots: weekly([2, 4], '19:00', 60), kind: 'kid', ages: JUNIOR, size: 10 },
    { key: 'veKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'vershina', ladder: 'bjjKids', coach: 'lubenikova', slots: weekly([2, 4], '20:00', 60), kind: 'kid', ages: SENIOR, size: 10 },
    { key: 'muKidsSenior', name: 'Дети Старшие', dir: 'bjj', gym: 'muromets', ladder: 'bjjKids', coach: 'reshetyuk', slots: [[2, '18:00', 60], [4, '18:00', 60], [6, '15:00', 60]], kind: 'kid', ages: SENIOR, size: 14 },
    { key: 'sbBjj', name: 'BJJ Взрослые', dir: 'bjj', gym: 'sibiryak', ladder: 'bjj', coach: 'chertovskikh', slots: [[2, '20:30', 90], [4, '20:30', 90], [6, '18:00', 90]], kind: 'adult', size: 20 },
    // Северск: the schedule is invented (the coach's free days in Томск).
    { key: 'svMuay', name: 'Тайский бокс Взрослые', dir: 'muay', gym: 'seversk', ladder: 'muay', coach: 'savelyev', slots: [[1, '12:00', 90], [3, '12:00', 90], [6, '10:00', 90]], kind: 'adult', size: 18 },
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
    // 30 days counted from the first training, not from the sale.
    startsOnFirstVisit?: boolean
}

const FROM_FIRST = '30 дней с первой тренировки'

export const TARIFFS: readonly TariffDef[] = [
    { key: 'trial', name: 'Пробное занятие', description: 'Первая тренировка бесплатно — в любой группе клуба', price: 0, classes: 1, days: 14, dirs: [], isFreeTrial: true },
    { key: 'single', name: 'Разовое', description: `Одна тренировка, ${FROM_FIRST}`, price: 500, classes: 1, days: 30, dirs: [], startsOnFirstVisit: true },
    { key: 'pack8', name: '8 занятий', description: `Весь клуб, ${FROM_FIRST}`, price: 4000, classes: 8, days: 30, dirs: [], startsOnFirstVisit: true },
    { key: 'pack12', name: '12 занятий', description: `Весь клуб, ${FROM_FIRST}. Самый популярный`, price: 5000, classes: 12, days: 30, dirs: [], startsOnFirstVisit: true },
    { key: 'unlim', name: 'Безлимит', description: `Весь клуб без ограничений, ${FROM_FIRST}`, price: 6000, classes: null, days: 30, dirs: [], startsOnFirstVisit: true },
    { key: 'muay12', name: 'Тайский бокс 12', description: `Тайский бокс в Северске, ${FROM_FIRST}`, price: 4500, classes: 12, days: 30, dirs: ['muay'], startsOnFirstVisit: true },
    { key: 'bjjMma12', name: 'БЖЖ + ММА 12', description: `BJJ и ММА, ${FROM_FIRST}`, price: 4800, classes: 12, days: 30, dirs: ['bjj', 'mma'], startsOnFirstVisit: true },
]

export type LadderDef = {
    key: LadderKey
    dir: DirKey
    name: string
    audience: string
    maxStripes: number
    // Days between level-ups (or stripes).
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
        key: 'bjj', dir: 'bjj', name: 'Пояса БЖЖ', audience: 'Взрослые', maxStripes: 4, stepDays: 75, coach: 'reshetyuk',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Синий', color: '#2563eb', minVisits: 28, minWeeks: 30, requirements: 'Выходы из всех удержаний, 3 свипа из закрытого гарда, 2 прохода гарда, спарринг 5 раундов' },
            { name: 'Фиолетовый', color: '#7c3aed', minVisits: 150, minWeeks: 78, requirements: 'Своя система гарда, связки атак, участие в турнирах' },
            { name: 'Коричневый', color: '#92400e', minVisits: 150, minWeeks: 78 },
            { name: 'Чёрный', color: '#111827', minVisits: 200, minWeeks: 104 },
        ],
    },
    {
        key: 'bjjKids', dir: 'bjj', name: 'Пояса БЖЖ — дети', audience: 'Дети 5–13', maxStripes: 4, stepDays: 60, coach: 'savelyev',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Серый', color: '#9ca3af', minVisits: 18, minWeeks: 12, requirements: 'Страховка, кувырки, удержание сбоку, выход из маунта' },
            { name: 'Жёлтый', color: '#facc15', minVisits: 30, minWeeks: 16 },
            { name: 'Оранжевый', color: '#f97316', minVisits: 30, minWeeks: 16 },
            { name: 'Зелёный', color: '#16a34a', minVisits: 30, minWeeks: 16 },
        ],
    },
    {
        key: 'mma', dir: 'mma', name: 'Уровни ММА', audience: 'Взрослые', maxStripes: 0, stepDays: 150, coach: 'starokorov',
        levels: [
            { name: 'Новичок', color: '#9ca3af' },
            { name: 'Любитель', color: '#f97316', minVisits: 24, minWeeks: 12, requirements: 'Базовая ударная техника, защита от тейкдауна, лёгкий спарринг' },
            { name: 'Продвинутый', color: '#dc2626', minVisits: 40, minWeeks: 26 },
            { name: 'Боец сборной', color: '#111827', minVisits: 60, minWeeks: 52 },
        ],
    },
    {
        key: 'muay', dir: 'muay', name: 'Пражиады', audience: 'Взрослые', maxStripes: 0, stepDays: 120, coach: 'savelyev',
        levels: [
            { name: 'Белый', color: '#f8fafc' },
            { name: 'Жёлтый', color: '#facc15', minVisits: 20, minWeeks: 10, requirements: 'Стойка, передвижения, прямые удары, тип' },
            { name: 'Зелёный', color: '#16a34a', minVisits: 30, minWeeks: 16 },
            { name: 'Синий', color: '#2563eb', minVisits: 40, minWeeks: 26 },
            { name: 'Красный', color: '#dc2626', minVisits: 60, minWeeks: 40 },
            { name: 'Чёрный', color: '#111827', minVisits: 80, minWeeks: 52 },
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
        key: 'bjj-kids-home', title: 'БЖЖ для детей: тренировка дома', dir: 'bjj', level: 'Дети',
        description: 'Игровая разминка и упражнения, которые можно делать с родителями',
        chapters: [
            ['Разминка', ['Кувырки и страховка', 'Игра «Крокодил»']],
            ['Борьба', ['Удержание сбоку', 'Выход из маунта']],
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
]

export const MALE_NAMES = [
    'Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл', 'Михаил',
    'Никита', 'Матвей', 'Роман', 'Егор', 'Арсений', 'Иван', 'Денис', 'Евгений', 'Тимофей', 'Владислав',
    'Игорь', 'Павел', 'Руслан', 'Марк', 'Глеб', 'Константин', 'Олег', 'Виктор', 'Антон', 'Ярослав',
    'Лев', 'Фёдор', 'Даниил', 'Степан', 'Захар', 'Богдан', 'Тимур', 'Савелий', 'Мирон', 'Пётр',
]
export const FEMALE_NAMES = [
    'Анна', 'Мария', 'Елена', 'Дарья', 'Алиса', 'Полина', 'Виктория', 'Екатерина', 'Софья', 'Анастасия',
    'Ксения', 'Валерия', 'Вероника', 'Арина', 'Ольга', 'Татьяна', 'Юлия', 'Наталья', 'Кристина', 'Ирина',
    'Варвара', 'Ева', 'Милана', 'Ульяна', 'Василиса',
]
// Male forms; the female form adds «а» (all end in -ов/-ев/-ёв/-ин).
export const SURNAMES = [
    'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Михайлов', 'Новиков', 'Фёдоров', 'Алексеев', 'Семёнов',
    'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьёв',
    'Борисов', 'Яковлев', 'Григорьев', 'Романов', 'Воробьёв', 'Сергеев', 'Кузьмин', 'Фролов', 'Александров', 'Дмитриев',
    'Королёв', 'Гусев', 'Киселёв', 'Ильин', 'Максимов', 'Поляков', 'Сорокин', 'Виноградов', 'Белов', 'Медведев',
    'Антонов', 'Тарасов', 'Жуков', 'Баранов', 'Филиппов', 'Комаров', 'Давыдов', 'Беляев', 'Герасимов', 'Богданов',
    'Осипов', 'Сидоров', 'Матвеев', 'Титов', 'Марков', 'Миронов', 'Крылов', 'Куликов', 'Карпов', 'Мельников',
    'Денисов', 'Гаврилов', 'Тихонов', 'Казаков', 'Афанасьев', 'Данилов', 'Тимофеев', 'Фомин', 'Чернов', 'Абрамов',
    'Мартынов', 'Ефимов', 'Федотов', 'Щербаков', 'Назаров', 'Калинин', 'Исаев', 'Быков', 'Лазарев', 'Воронин',
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
