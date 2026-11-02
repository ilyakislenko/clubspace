import { PrismaService } from '../../infrastructure/prisma'
import { pluralRu } from './plural-ru'

// The words a club uses for its classes and its staff, keyed by Workspace.type:
// a BJJ academy runs «тренировки» led by a «тренер», a dance studio runs
// «занятия» led by a «педагог». Pushes, e-mails, default achievements and the
// member-facing errors read them from here instead of hard-coding
// «тренировка/тренер».
//
// Mirror of `libs/ui-kit/brand/vocabulary.ts` (the server build cannot reach
// libs/ui-kit); `club-vocabulary.spec.ts` pins both to the same words.

export type NounGender = 'm' | 'f' | 'n'

/** A noun (or adjective + noun phrase) in every case the copy needs. */
export type Noun = {
    gender: NounGender
    nom: string
    /** Родительный, ед.; also the «2–4» counting form. */
    gen: string
    dat: string
    acc: string
    ins: string
    prep: string
    nomPl: string
    /** Родительный, мн.; also the «5+» counting form. */
    genPl: string
    datPl: string
    insPl: string
    prepPl: string
}

export type SessionNoun = Noun & { gender: 'f' | 'n' }

export type ClubVocabulary = {
    session: SessionNoun
    personalSession: SessionNoun
    personalTag: string
    coach: Noun
    headCoach: Noun
    practiceImperative: string
}

const noun = <G extends NounGender>(
    gender: G,
    [nom, gen, dat, acc, ins, prep]: readonly [string, string, string, string, string, string],
    [nomPl, genPl, datPl, insPl, prepPl]: readonly [string, string, string, string, string],
): Noun & { gender: G } => ({
    gender,
    nom,
    gen,
    dat,
    acc,
    ins,
    prep,
    nomPl,
    genPl,
    datPl,
    insPl,
    prepPl,
})

const TRAINING = noun(
    'f',
    ['тренировка', 'тренировки', 'тренировке', 'тренировку', 'тренировкой', 'тренировке'],
    ['тренировки', 'тренировок', 'тренировкам', 'тренировками', 'тренировках'],
)

const CLASS = noun(
    'n',
    ['занятие', 'занятия', 'занятию', 'занятие', 'занятием', 'занятии'],
    ['занятия', 'занятий', 'занятиям', 'занятиями', 'занятиях'],
)

const PERSONAL_TRAINING = noun(
    'f',
    [
        'персональная тренировка',
        'персональной тренировки',
        'персональной тренировке',
        'персональную тренировку',
        'персональной тренировкой',
        'персональной тренировке',
    ],
    [
        'персональные тренировки',
        'персональных тренировок',
        'персональным тренировкам',
        'персональными тренировками',
        'персональных тренировках',
    ],
)

const PERSONAL_CLASS = noun(
    'n',
    [
        'индивидуальное занятие',
        'индивидуального занятия',
        'индивидуальному занятию',
        'индивидуальное занятие',
        'индивидуальным занятием',
        'индивидуальном занятии',
    ],
    [
        'индивидуальные занятия',
        'индивидуальных занятий',
        'индивидуальным занятиям',
        'индивидуальными занятиями',
        'индивидуальных занятиях',
    ],
)

// Staff nouns are animate: the accusative matches the genitive.
const COACH = noun(
    'm',
    ['тренер', 'тренера', 'тренеру', 'тренера', 'тренером', 'тренере'],
    ['тренеры', 'тренеров', 'тренерам', 'тренерами', 'тренерах'],
)
const TEACHER = noun(
    'm',
    ['педагог', 'педагога', 'педагогу', 'педагога', 'педагогом', 'педагоге'],
    ['педагоги', 'педагогов', 'педагогам', 'педагогами', 'педагогах'],
)
const INSTRUCTOR = noun(
    'm',
    ['преподаватель', 'преподавателя', 'преподавателю', 'преподавателя', 'преподавателем', 'преподавателе'],
    ['преподаватели', 'преподавателей', 'преподавателям', 'преподавателями', 'преподавателях'],
)

const head = (n: Noun): Noun =>
    noun(
        'm',
        [
            `главный ${n.nom}`,
            `главного ${n.gen}`,
            `главному ${n.dat}`,
            `главного ${n.acc}`,
            `главным ${n.ins}`,
            `главном ${n.prep}`,
        ],
        [
            `главные ${n.nomPl}`,
            `главных ${n.genPl}`,
            `главным ${n.datPl}`,
            `главными ${n.insPl}`,
            `главных ${n.prepPl}`,
        ],
    )

const SPORT: ClubVocabulary = {
    session: TRAINING,
    personalSession: PERSONAL_TRAINING,
    personalTag: 'персональная',
    coach: COACH,
    headCoach: head(COACH),
    practiceImperative: 'Тренируйтесь',
}

const DANCE: ClubVocabulary = {
    session: CLASS,
    personalSession: PERSONAL_CLASS,
    personalTag: 'индивидуальное',
    coach: TEACHER,
    headCoach: head(TEACHER),
    practiceImperative: 'Занимайтесь',
}

const YOGA: ClubVocabulary = {
    session: CLASS,
    personalSession: PERSONAL_CLASS,
    personalTag: 'индивидуальное',
    coach: INSTRUCTOR,
    headCoach: head(INSTRUCTOR),
    practiceImperative: 'Занимайтесь',
}

const CUSTOM: ClubVocabulary = {
    session: CLASS,
    personalSession: PERSONAL_CLASS,
    personalTag: 'индивидуальное',
    coach: COACH,
    headCoach: head(COACH),
    practiceImperative: 'Занимайтесь',
}

/**
 * The vocabulary of a club by its `Workspace.type`. GRAPPLING and FITNESS keep
 * «тренировка / тренер»; so does an unknown or missing type.
 */
export const vocabularyForWorkspaceType = (
    type: string | null | undefined,
): ClubVocabulary => {
    switch ((type ?? '').toUpperCase()) {
        case 'DANCE':
            return DANCE
        case 'YOGA':
            return YOGA
        case 'CUSTOM':
            return CUSTOM
        default:
            return SPORT
    }
}

/** The form that agrees with a class noun's gender. */
export const agree = (noun: SessionNoun, feminine: string, neuter: string): string =>
    noun.gender === 'n' ? neuter : feminine

/** First letter upper-cased, for a noun that opens a sentence or a title. */
export const cap = (s: string): string =>
    s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)

/** «с первой тренировки» / «с первого занятия». */
export const fromFirstSession = (vocabulary: ClubVocabulary): string =>
    `с ${agree(vocabulary.session, 'первой', 'первого')} ${vocabulary.session.gen}`

/** «21 занятие», «3 тренировки», «11 занятий». */
export const countNoun = (n: number, noun: Noun): string =>
    `${n} ${pluralRu(n, noun.nom, noun.gen, noun.genPl)}`

/** The vocabulary of a club by id; a missing club reads as the default. */
export const loadClubVocabulary = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<ClubVocabulary> =>
    vocabularyForWorkspaceType(
        (
            await prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { type: true },
            })
        )?.type,
    )
