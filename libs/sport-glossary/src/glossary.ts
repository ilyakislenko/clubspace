// The sport vocabulary shared by the video worker and the server: what
// chapter titles and transcripts are snapped to (worker term-snap.ts), what
// Whisper is primed with, and — through its sections — the technique
// catalogue members browse («Техники», techniques.ts). Canonical spellings,
// most common first (the Whisper prompt takes them in this order until its
// budget runs out). Keyed by the club's WorkspaceType — the platform is
// multi-discipline. Extend a list by adding the term as it should be written;
// a club's own course, video and manual chapter titles are added at run time.

/** The club's WorkspaceType (the Prisma enum, kept free of a Prisma import). */
export type SportType = 'GRAPPLING' | 'FITNESS' | 'YOGA' | 'DANCE' | 'CUSTOM'

/** Where a technique sits in the catalogue; null = vocabulary only. */
export type TechniqueCategory =
    | 'submissions'
    | 'guards'
    | 'passes'
    | 'sweeps'
    | 'takedowns'
    | 'positions'
    | 'escapes'
    | 'other'

export interface TermSection {
    category: TechniqueCategory | null
    terms: readonly string[]
}

const GRAPPLING_SECTIONS: readonly TermSection[] = [
    // Submissions
    {
        category: 'submissions',
        terms: [
            'Kimura',
            'Americana',
            'Armbar',
            'Triangle',
            'Triangle Choke',
            'Omoplata',
            'Rear Naked Choke',
            'Guillotine',
            'Darce',
            'Darce Choke',
            'Anaconda',
            'Anaconda Choke',
            'Arm Triangle',
            'Ezekiel',
            'Ezekiel Choke',
            'Bow and Arrow',
            'Bow and Arrow Choke',
            'Cross Collar Choke',
            'Loop Choke',
            'Baseball Bat Choke',
            'Clock Choke',
            'Paper Cutter',
            'North-South Choke',
            'Peruvian Necktie',
            'Japanese Necktie',
            'Gogoplata',
            'Monoplata',
            'Tarikoplata',
            'Baratoplata',
            'Crucifix',
            'Twister',
            'Banana Split',
            'Electric Chair',
            'Wrist Lock',
            'Heel Hook',
            'Inside Heel Hook',
            'Outside Heel Hook',
            'Toe Hold',
            'Knee Bar',
            'Calf Slicer',
            'Bicep Slicer',
            'Straight Ankle Lock',
            'Estima Lock',
            'Aoki Lock',
        ],
    },
    // Leg entanglements
    {
        category: 'positions',
        terms: [
            'Ashi Garami',
            'Outside Ashi Garami',
            'Cross Ashi',
            'Saddle',
            'Honey Hole',
            'Inside Sankaku',
            'Sankaku',
            'Single Leg X',
            'SLX',
            'X-Guard',
            '50/50',
            'Backside 50/50',
            'Irimi Ashi',
        ],
    },
    // Guards
    {
        category: 'guards',
        terms: [
            'Closed Guard',
            'Open Guard',
            'Half Guard',
            'Deep Half',
            'Deep Half Guard',
            'Lockdown',
            'Butterfly Guard',
            'De La Riva',
            'Reverse De La Riva',
            'Spider Guard',
            'Lasso Guard',
            'Collar Sleeve',
            'Worm Guard',
            'Lapel Guard',
            'Rubber Guard',
            'K-Guard',
            'Z-Guard',
            'Knee Shield',
            'Shin to Shin',
            'Octopus Guard',
            'Williams Guard',
            'Seated Guard',
            'Inverted Guard',
            'Berimbolo',
            'Kiss of the Dragon',
            'Crab Ride',
            'Waiter Guard',
            'Dogfight',
        ],
    },
    // Positions and control
    {
        category: 'positions',
        terms: [
            'Mount',
            'S-Mount',
            'Technical Mount',
            'Side Control',
            'Kesa Gatame',
            'Kuzure Kesa Gatame',
            'Yoko Shiho Gatame',
            'Kami Shiho Gatame',
            'Tate Shiho Gatame',
            'North-South',
            'Knee on Belly',
            'Turtle',
            'Back Control',
            'Back Take',
            'Body Triangle',
            'Seatbelt',
            'Harness',
            'Truck',
            'Front Headlock',
            'Underhook',
            'Overhook',
            'Whizzer',
            'Crossface',
            'Collar Tie',
            'Two on One',
            'Russian Tie',
            'Arm Drag',
        ],
    },
    // Sweeps
    {
        category: 'sweeps',
        terms: [
            'Scissor Sweep',
            'Hip Bump Sweep',
            'Flower Sweep',
            'Pendulum Sweep',
            'Tripod Sweep',
            'Sickle Sweep',
            'Elevator Sweep',
            'Butterfly Sweep',
            'Tornado Sweep',
            'Balloon Sweep',
        ],
    },
    // Guard passes
    {
        category: 'passes',
        terms: [
            'Knee Cut',
            'Knee Slice',
            'Torreando',
            'Leg Drag',
            'Over-Under',
            'Stack Pass',
            'Smash Pass',
            'Long Step',
            'Body Lock Pass',
            'Leg Weave',
            'Float Pass',
            'Headquarters',
        ],
    },
    // Takedowns: wrestling and judo
    {
        category: 'takedowns',
        terms: [
            'Single Leg',
            'Double Leg',
            'High Crotch',
            'Ankle Pick',
            'Snap Down',
            'Duck Under',
            "Fireman's Carry",
            'Sprawl',
            'Body Lock',
            'Inside Trip',
            'Outside Trip',
            'Foot Sweep',
            'Uchi Mata',
            'Osoto Gari',
            'Ouchi Gari',
            'Kouchi Gari',
            'Kosoto Gari',
            'Seoi Nage',
            'Ippon Seoi Nage',
            'Harai Goshi',
            'O Goshi',
            'Tai Otoshi',
            'Tomoe Nage',
            'Sumi Gaeshi',
            'De Ashi Barai',
            'Sasae Tsurikomi Ashi',
            'Kata Guruma',
            'Hiza Guruma',
            'Sukui Nage',
            'Morote Gari',
            'Kibisu Gaeshi',
            'Tani Otoshi',
            'Ura Nage',
            'Suplex',
        ],
    },
    // Getting out from under: wrestling
    {
        category: 'escapes',
        terms: [
            'Peterson Roll',
            'Granby Roll',
            'Sit Out',
        ],
    },
    // Movement
    {
        category: 'escapes',
        terms: [
            'Shrimp',
            'Hip Escape',
            'Upa',
            'Technical Stand Up',
        ],
    },
    // Concepts and clothing: vocabulary, not techniques
    {
        category: null,
        terms: [
            'Kuzushi',
            'Grip Fighting',
            'Pummeling',
            'Inversion',
            'Gi',
            'No-Gi',
        ],
    },
    // Russian: Whisper priming only (the techniques are the English terms)
    {
        category: null,
        terms: [
            'кимура',
            'американа',
            'омоплата',
            'гогоплата',
            'рычаг локтя',
            'рычаг колена',
            'треугольник',
            'санкаку',
            'гильотина',
            'анаконда',
            'дарс',
            'удушение сзади',
            'удушение',
            'хилхук',
            'ущемление пятки',
            'ущемление ахилла',
            'крусификс',
            'маунт',
            'сайд контроль',
            'кеса гатаме',
            'колено на животе',
            'черепаха',
            'бэк контроль',
            'гард',
            'закрытый гард',
            'полугард',
            'халф гард',
            'дипхалф',
            'локдаун',
            'баттерфляй',
            'де ла рива',
            'беримболо',
            'кроссфейс',
            'андерхук',
            'оверхук',
            'виззер',
            'сингл лег',
            'дабл лег',
            'проход в ноги',
            'тейкдаун',
            'свип',
            'проход гарда',
            'учи мата',
            'осото гари',
            'сеой нагэ',
            'креветка',
            'мостик',
            'подсечка',
            'бросок',
        ],
    },
]

const GRAPPLING = GRAPPLING_SECTIONS.flatMap((s) => s.terms)


const FITNESS = [
    'Burpee',
    'Kettlebell',
    'Deadlift',
    'Squat',
    'Lunge',
    'Plank',
    'Push-up',
    'Pull-up',
    'Tabata',
    'AMRAP',
    'EMOM',
    'HIIT',
    'Clean and Jerk',
    'Snatch',
] as const

const YOGA = [
    'Vinyasa',
    'Asana',
    'Pranayama',
    'Savasana',
    'Tadasana',
    'Balasana',
    'Bhujangasana',
    'Trikonasana',
    'Virabhadrasana',
    'Adho Mukha Svanasana',
    'Chaturanga',
    'Surya Namaskar',
] as const

const DANCE = [
    'Choreography',
    'Hip-hop',
    'High Heels',
    'Contemporary',
    'Breaking',
    'Popping',
    'Locking',
    'Waacking',
    'Vogue',
] as const

/**
 * The vocabulary in sections — the technique catalogue's categories. The
 * flat lists below (SPORT_TERMS) are these, in the same order.
 */
export const SPORT_TERM_SECTIONS: Record<SportType, readonly TermSection[]> = {
    GRAPPLING: GRAPPLING_SECTIONS,
    FITNESS: [{ category: 'other', terms: FITNESS }],
    YOGA: [{ category: 'other', terms: YOGA }],
    DANCE: [{ category: 'other', terms: DANCE }],
    CUSTOM: [],
}

export const SPORT_TERMS: Record<SportType, readonly string[]> = {
    GRAPPLING,
    FITNESS,
    YOGA,
    DANCE,
    // A club of its own kind: its titles are the vocabulary.
    CUSTOM: [],
}

// Words Whisper hears for a term that no spelling distance leads back to
// (the term is too short to snap): lowercase, as heard → as written.
export const SPORT_MISHEARINGS: Record<SportType, Readonly<Record<string, string>>> = {
    GRAPPLING: { ghee: 'gi', 'no ghee': 'no-gi', 'no-ghee': 'no-gi' },
    FITNESS: {},
    YOGA: {},
    DANCE: {},
    CUSTOM: {},
}

/**
 * A term as members say it in Russian. Russian athletes mostly say the
 * English terms transliterated; a model translating word for word does not
 * («crossface» → «крестный захват»).
 */
export interface RussianTerm {
    /** The English term as spoken, any case; spaces and hyphens alike. */
    en: string
    /** What to say instead, in the nominative. */
    ru: string
    /**
     * Russian a model writes for it instead: words, `*` standing for a case
     * ending («осьминог*» is «осьминога», «осьминогом» …). Replaced by `ru`
     * wherever the English said the term. The English term itself, left in
     * Latin letters, is replaced too.
     */
    wrong?: readonly string[]
}

const GRAPPLING_RUSSIAN: readonly RussianTerm[] = [
    // Clothing
    { en: 'gi', ru: 'ги', wrong: ['гее', 'гхи', 'гхее', 'джи'] },
    { en: 'no-gi', ru: 'ноу-ги', wrong: ['без ги', 'без гее', 'но-ги'] },
    // Submissions
    { en: 'kimura', ru: 'кимура' },
    { en: 'americana', ru: 'американа' },
    { en: 'armbar', ru: 'рычаг локтя', wrong: ['рычаг* рук*', 'армбар*'] },
    { en: 'triangle', ru: 'треугольник' },
    { en: 'omoplata', ru: 'омоплата' },
    { en: 'guillotine', ru: 'гильотина' },
    { en: 'darce', ru: 'дарс' },
    { en: 'anaconda', ru: 'анаконда' },
    { en: 'rear naked choke', ru: 'удушение сзади', wrong: ['голо* удушени*'] },
    { en: 'crucifix', ru: 'крусификс', wrong: ['крест*', 'распяти*'] },
    { en: 'heel hook', ru: 'хилхук', wrong: ['крюк* пятк*', 'хук* пятк*', 'пяточн* крюк*', 'пяточн* хук*'] },
    { en: 'inside heel hook', ru: 'внутренний хилхук' },
    { en: 'outside heel hook', ru: 'внешний хилхук' },
    { en: 'toe hold', ru: 'тоу-холд', wrong: ['захват* пальц*', 'удержани* пальц*', 'захват* носк*'] },
    { en: 'knee bar', ru: 'ни-бар', wrong: ['коленн* бар*', 'бар* колен*', 'коленн* планк*'] },
    { en: 'wrist lock', ru: 'рычаг кисти', wrong: ['замок* запясть*'] },
    { en: 'calf slicer', ru: 'кальф-слайсер' },
    // Leg entanglements
    { en: 'ashi garami', ru: 'аши-гарами' },
    { en: 'inside sankaku', ru: 'инсайд-санкаку' },
    { en: 'sankaku', ru: 'санкаку' },
    { en: 'single leg x', ru: 'SLX' },
    { en: 'slx', ru: 'SLX' },
    { en: 'x-guard', ru: 'икс-гард', wrong: ['х-гард*', 'икс-защит*'] },
    { en: '50/50', ru: '50/50', wrong: ['пятьдесят на пятьдесят'] },
    { en: 'saddle', ru: 'сэддл', wrong: ['седл*'] },
    { en: 'honey hole', ru: 'хани-хол', wrong: ['медов* дыр*'] },
    // Guards
    { en: 'guard', ru: 'гард', wrong: ['защит*'] },
    { en: 'closed guard', ru: 'закрытый гард', wrong: ['закрыт* защит*'] },
    { en: 'open guard', ru: 'открытый гард', wrong: ['открыт* защит*'] },
    { en: 'half guard', ru: 'полугард', wrong: ['половинн* гард*', 'половинн* защит*', 'полузащит*', 'полу-гард*'] },
    { en: 'deep half', ru: 'дипхалф', wrong: ['глубок* половинн*', 'глубок* полугард*'] },
    { en: 'butterfly guard', ru: 'баттерфляй-гард', wrong: ['гард* бабочк*', 'защит* бабочк*', 'бабочк*'] },
    { en: 'octopus guard', ru: 'октопус-гард', wrong: ['гард* осьминог*', 'осьминог* гард*', 'защит* осьминог*'] },
    { en: 'octopus', ru: 'октопус', wrong: ['осьминог*'] },
    { en: 'de la riva', ru: 'де ла рива' },
    { en: 'lockdown', ru: 'локдаун', wrong: ['блокировк*'] },
    { en: 'berimbolo', ru: 'беримболо' },
    // Positions and control
    { en: 'mount', ru: 'маунт', wrong: ['монтаж*', 'маунтин*'] },
    { en: 'side control', ru: 'сайд-контроль', wrong: ['боков* контрол*', 'контрол* сбоку'] },
    { en: 'knee on belly', ru: 'колено на животе' },
    { en: 'north-south', ru: 'норт-саут', wrong: ['север*-юг*', 'север* юг*'] },
    { en: 'turtle', ru: 'черепаха' },
    { en: 'back control', ru: 'контроль спины' },
    { en: 'back take', ru: 'взятие спины', wrong: ['взят* назад'] },
    { en: 'body triangle', ru: 'боди-трайэнгл', wrong: ['треугольник* тел*'] },
    { en: 'seatbelt', ru: 'ситбелт', wrong: ['ремн* безопасност*'] },
    { en: 'front headlock', ru: 'фронт-хедлок' },
    { en: 'underhook', ru: 'андерхук', wrong: ['нижн* захват*', 'подкрюк*'] },
    { en: 'overhook', ru: 'оверхук', wrong: ['верхн* захват*', 'надкрюк*'] },
    { en: 'whizzer', ru: 'виззер' },
    { en: 'crossface', ru: 'кроссфейс', wrong: ['крестн* захват*', 'перекрестн* захват*', 'перекрёстн* захват*'] },
    { en: 'collar tie', ru: 'коллар-тай' },
    { en: 'arm drag', ru: 'армдрэг' },
    // Sweeps, passes, takedowns
    { en: 'sweep', ru: 'свип', wrong: ['подметани*', 'зачистк*'] },
    { en: 'pass', ru: 'проход', wrong: ['пас*', 'пасс*'] },
    { en: 'knee cut', ru: 'ни-кат', wrong: ['разрез* колен*'] },
    { en: 'leg drag', ru: 'лег-драг' },
    { en: 'takedown', ru: 'тейкдаун' },
    { en: 'single leg', ru: 'сингл-лег', wrong: ['одиночн* ног*'] },
    { en: 'double leg', ru: 'дабл-лег', wrong: ['двойн* ног*'] },
    { en: 'sprawl', ru: 'спрол' },
    { en: 'uchi mata', ru: 'учи-мата' },
    { en: 'osoto gari', ru: 'осото-гари' },
    // Movement
    { en: 'shrimp', ru: 'креветка' },
    { en: 'hip escape', ru: 'креветка', wrong: ['побег* бедр*', 'выход* бедр*'] },
    { en: 'frame', ru: 'фрейм', wrong: ['рамк*', 'рам'] },
]

export const SPORT_RUSSIAN_TERMS: Record<SportType, readonly RussianTerm[]> = {
    GRAPPLING: GRAPPLING_RUSSIAN,
    FITNESS: [],
    YOGA: [],
    DANCE: [],
    CUSTOM: [],
}

// Common Russian words of 4+ letters — the ones a coach says in any lesson —
// so snapping never "corrects" them into a term («город» → «гард»). Written
// by hand (no corpus file is bundled): frequent function words, numbers,
// body parts, directions and everyday training talk. Russian endings are
// also left alone by the snapper itself (term-snap.ts), so the forms listed
// are the ones too different from a term's to be caught that way.
export const COMMON_RUSSIAN_WORDS: ReadonlySet<string> = new Set(
    `
    если когда потом сейчас теперь здесь тут туда сюда очень просто только
    можно нужно надо будет будем было была были есть нету этот этого этому
    этим этой эта эти этих того тому тем той тот такой такая такое такие так
    также тоже всегда никогда почему потому чтобы который которая которое
    которые какой какая какое какие кто что чем чего себя себе свой своя свое
    свои своих своей своим своего меня мне мной тебя тебе тобой него нему ним
    неё ней нами вами ними наш наша наше наши ваш ваша ваше ваши после перед
    через между около вокруг внутри снаружи сверху снизу сзади спереди сбоку
    сторону стороне сторона право лево правая левая правой левой правую левую
    правый левый рука руки руку рукой руке рукам руками нога ноги ногу ногой
    ноге ногам ногами колено колени коленом коленях бедро бедра бедром таз
    таза тазом плечо плеча плечом плечи спина спины спиной спину голова головы
    голову головой шея шеи шею локоть локтя локтем кисть кисти пятка пятки
    пятку стопа стопы стопу корпус корпуса тело тела телом вес веса весом
    давление давить держать держим держу держит тянуть тянем тянет толкать
    толкаем толкает делать делаем делает делаю сделать сделаем сделаю делай
    смотреть смотрим смотрите видеть видим видите знать знаем знаете хотим
    хочу хочет хотите можем могу может могут нужен нужна нужны важно важный
    очень хорошо плохо лучше хуже больше меньше много мало немного сильно
    слабо быстро медленно легко сложно просто правильно неправильно ошибка
    ошибки ошибку партнёр партнер партнера партнёра партнеру партнёру соперник
    соперника сопернику соперником противник противника противнику позиция
    позиции позицию позицией контроль контроля контролем захват захвата
    захватом захваты прием приём приема приёма техника техники технику
    движение движения движением упражнение упражнения тренировка тренировки
    тренировку разминка разминки начинаем начинать начало конец дальше снова
    опять обратно вперед вперёд назад вверх вниз город время раза разом
    первый первая первое второй вторая второе третий третья один одна одно
    одну двое двумя трое пять шесть семь восемь девять десять сегодня завтра
    вчера всем всех всего вообще конечно например значит короче давайте
    давай смотри ребята ребят друзья спасибо пожалуйста привет пока
    часть части урок урока уроки курс курса курсы выпуск глава видео дома
    детей детям дети база базы белого пояса пояс тренировка тренировки
    трахея трахеи трахею трахеей кадык кадыка горло горла горлу горлом
    артерия артерии артерию сонная сонной сонную ключица ключицы ключицу
    грудина грудины грудину лопатка лопатки лопатку лопаткой лопаток
    позвоночник позвоночника позвонок позвонки шейный шейные поясница поясницы
    копчик ребро ребра рёбра ребер рёбер мениск мениска связка связки связку
    сухожилие сухожилия бицепс трицепс предплечье предплечья запястье
    запястья лодыжка лодыжки голень голени травма травмы перелом вывих
    `
        .split(/\s+/)
        .filter(Boolean),
)
