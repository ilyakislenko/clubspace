import { toCsv } from '../../shared/utils/csv'

// The columns «Импорт клуба» understands. Order = the template's order and the
// order of the mapping step in the wizard.
export const CLUB_IMPORT_FIELD_KEYS = [
    'fullName',
    'lastname',
    'firstname',
    'email',
    'phone',
    'dateOfBirth',
    'parentEmail',
    'parentName',
    'parentPhone',
    'gym',
    'direction',
    'group',
    'rank',
    'stripes',
    'plan',
    'startDate',
    'endDate',
    'classesLeft',
    'paid',
    'notes',
] as const

export type ClubImportFieldKey = (typeof CLUB_IMPORT_FIELD_KEYS)[number]

// Field key → column index in the file. Absent = not imported.
export type ClubImportMapping = Partial<Record<ClubImportFieldKey, number>>

export const CLUB_IMPORT_FIELD_LABELS: Record<ClubImportFieldKey, string> = {
    fullName: 'ФИО',
    lastname: 'Фамилия',
    firstname: 'Имя',
    email: 'E-mail',
    phone: 'Телефон',
    dateOfBirth: 'Дата рождения',
    parentEmail: 'E-mail родителя',
    parentName: 'ФИО родителя',
    parentPhone: 'Телефон родителя',
    gym: 'Зал',
    direction: 'Направление',
    group: 'Группа',
    rank: 'Пояс / уровень',
    stripes: 'Полоски',
    plan: 'Абонемент',
    startDate: 'Дата начала',
    endDate: 'Дата окончания',
    classesLeft: 'Осталось занятий',
    paid: 'Оплачено',
    notes: 'Заметки',
}

// Lower-case, «ё» → «е», punctuation and repeated spaces collapsed: «E-mail
// родителя» and «email  родителя» compare equal.
export const normalizeHeader = (header: string): string =>
    header
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]+/g, ' ')
        .trim()

const ALIASES: Record<ClubImportFieldKey, string[]> = {
    fullName: [
        'фио',
        'ф и о',
        'фамилия имя',
        'фамилия имя отчество',
        'фамилия и имя',
        'ученик',
        'спортсмен',
        'участник',
        'full name',
        'fullname',
        'name',
    ],
    lastname: ['фамилия', 'last name', 'lastname', 'surname', 'family name'],
    firstname: ['имя', 'first name', 'firstname', 'given name'],
    email: [
        'e mail',
        'email',
        'почта',
        'эл почта',
        'электронная почта',
        'e mail ученика',
        'mail',
    ],
    phone: [
        'телефон',
        'тел',
        'мобильный',
        'мобильный телефон',
        'номер телефона',
        'phone',
        'mobile',
    ],
    dateOfBirth: [
        'дата рождения',
        'д р',
        'др',
        'день рождения',
        'birthday',
        'birth date',
        'birthdate',
        'date of birth',
        'dob',
    ],
    parentEmail: [
        'родитель',
        'e mail родителя',
        'email родителя',
        'почта родителя',
        'родитель e mail',
        'parent',
        'parent email',
        'parent e mail',
        'guardian email',
    ],
    parentName: [
        'фио родителя',
        'ф и о родителя',
        'имя родителя',
        'родитель фио',
        'фио мамы',
        'фио папы',
        'parent name',
        'guardian name',
    ],
    parentPhone: [
        'телефон родителя',
        'тел родителя',
        'номер родителя',
        'номер телефона родителя',
        'родитель телефон',
        'телефон мамы',
        'телефон папы',
        'parent phone',
        'guardian phone',
    ],
    gym: ['зал', 'филиал', 'площадка', 'адрес зала', 'gym', 'location', 'club'],
    direction: [
        'направление',
        'дисциплина',
        'вид спорта',
        'секция',
        'direction',
        'discipline',
        'sport',
    ],
    group: ['группа', 'group', 'class'],
    // Not only belts: a dance or yoga studio keeps «Уровень», a gym «Грейд».
    rank: [
        'пояс',
        'ранг',
        'степень',
        'кю',
        'уровень',
        'грейд',
        'пояс ранг',
        'пояс уровень',
        'уровень пояс',
        'belt',
        'rank',
        'grade',
        'level',
    ],
    stripes: ['полоски', 'полосы', 'нашивки', 'страйпы', 'stripes', 'degrees'],
    plan: [
        'абонемент',
        'тариф',
        'вид абонемента',
        'plan',
        'membership',
        'subscription',
        'tariff',
    ],
    startDate: [
        'дата начала',
        'начало',
        'начало абонемента',
        'действует с',
        'с',
        'start',
        'start date',
        'valid from',
    ],
    endDate: [
        'дата окончания',
        'окончание',
        'конец',
        'действует до',
        'по',
        'окончание абонемента',
        'end',
        'end date',
        'valid until',
        'expires',
    ],
    classesLeft: [
        'осталось занятий',
        'осталось',
        'остаток',
        'остаток занятий',
        'занятий осталось',
        'classes left',
        'remaining',
        'remaining classes',
    ],
    paid: ['оплачено', 'оплачен', 'оплата', 'paid', 'is paid'],
    notes: [
        'заметки',
        'заметка',
        'примечание',
        'примечания',
        'комментарий',
        'notes',
        'note',
        'comment',
    ],
}

// Loose rules for headers no alias names exactly, most specific first (a
// «Телефон родителя» must not become the student's phone).
const FALLBACKS: Array<[RegExp, ClubImportFieldKey | null]> = [
    // No \b: it only knows Latin letters («тел мамы» has no boundary after «тел»).
    [/^(?=.*(родител|parent|мам|пап|опекун))(?=.*(телеф|phone|моб|(^|\s)тел(\s|$))).*/, 'parentPhone'],
    [/^(?=.*(родител|parent|мам|пап|опекун))(?=.*(фио|имя|name)).*/, 'parentName'],
    [/родител|parent|мам|пап|опекун/, 'parentEmail'],
    [/рожден|birth/, 'dateOfBirth'],
    [/mail|почт/, 'email'],
    [/телеф|phone|моб/, 'phone'],
    [/фио|full ?name/, 'fullName'],
    [/фамил|surname/, 'lastname'],
    [/полос|stripe/, 'stripes'],
    [/пояс|ранг|уровен|грейд|belt|rank|level/, 'rank'],
    [/абонем|тариф|plan/, 'plan'],
    [/осталось|остаток|remaining/, 'classesLeft'],
    [/оплач|paid/, 'paid'],
    [/начал|start/, 'startDate'],
    [/оконч|действует до|end|expir/, 'endDate'],
    [/направлен|дисципл/, 'direction'],
    [/групп|group/, 'group'],
    [/зал|филиал|gym/, 'gym'],
    [/замет|примеч|коммент|note/, 'notes'],
]

// Guess the mapping from the header row: exact aliases first (over every
// column), then the loose rules. A field takes at most one column and a
// column feeds at most one field. «ФИО» wins over separate name columns only
// when there are none.
export const suggestMapping = (headers: string[]): ClubImportMapping => {
    const mapping: ClubImportMapping = {}
    const used = new Set<number>()
    const normalized = headers.map(normalizeHeader)
    for (const key of CLUB_IMPORT_FIELD_KEYS) {
        const idx = normalized.findIndex(
            (h, i) => !used.has(i) && ALIASES[key].includes(h),
        )
        if (idx !== -1) {
            mapping[key] = idx
            used.add(idx)
        }
    }
    normalized.forEach((h, i) => {
        if (used.has(i) || !h) return
        const hit = FALLBACKS.find(([re, key]) => key && mapping[key] === undefined && re.test(h))
        if (hit && hit[1]) {
            mapping[hit[1]] = i
            used.add(i)
        }
    })
    if (
        mapping.fullName !== undefined &&
        (mapping.firstname !== undefined || mapping.lastname !== undefined)
    ) {
        delete mapping.fullName
    }
    return mapping
}

// The template the wizard offers for download: Russian headers the
// auto-detection recognises, and two example rows (an adult with an
// abonement and a rank, a child signed up by a parent's e-mail).
export const CLUB_IMPORT_TEMPLATE_HEADERS = [
    'ФИО',
    'E-mail',
    'Телефон',
    'Дата рождения',
    'E-mail родителя',
    'ФИО родителя',
    'Телефон родителя',
    'Зал',
    'Направление',
    'Группа',
    'Пояс / уровень',
    'Полоски',
    'Абонемент',
    'Дата начала',
    'Дата окончания',
    'Осталось занятий',
    'Оплачено',
    'Заметки',
]

export const buildClubImportTemplate = (): string =>
    toCsv(CLUB_IMPORT_TEMPLATE_HEADERS, [
        [
            'Иванов Иван',
            'ivan@example.com',
            '8 900 123-45-67',
            '15.04.1990',
            '',
            '',
            '',
            'Центральный',
            'БЖЖ',
            'Взрослые вечер',
            'Синий пояс',
            2,
            '12 занятий',
            '01.11.2026',
            '30.11.2026',
            8,
            'да',
            '',
        ],
        [
            'Петрова Маша',
            '',
            '',
            '03.09.2016',
            'mama@example.com',
            'Петрова Анна',
            '8 900 765-43-21',
            'Центральный',
            'БЖЖ',
            'Дети 7-10',
            'Белый пояс',
            1,
            'Безлимит месяц',
            '01.11.2026',
            '',
            '',
            'нет',
            'аллергия на орехи',
        ],
    ])
