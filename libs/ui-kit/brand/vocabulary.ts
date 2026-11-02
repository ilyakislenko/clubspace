/**
 * The words a club uses for its classes and its staff, keyed by Workspace.type.
 *
 * A BJJ academy runs «тренировки» led by a «тренер»; a dance studio runs
 * «занятия» led by a «педагог». Every user-facing string that names a class or
 * a coach inside a club reads them from here instead of hard-coding
 * «тренировка/тренер». Screens shown before a club is picked use neutral
 * wording rather than any club's vocabulary.
 *
 * The unit an abonement counts is not a class word: it is «занятие» in every
 * club, as in tariffs («8 занятий»), «Осталось N занятий» and what a visit, a
 * late cancel or a no-show takes from it («спишется занятие», «Списывать
 * занятие при неявке»). The admin vocabulary guard lists those strings.
 *
 * The server keeps a mirror (`apps/server/src/shared/vocabulary/club-vocabulary.ts`)
 * for pushes, e-mails and default achievements; a server spec pins both to the
 * same words.
 */

export type NounGender = "m" | "f" | "n"

/** A noun (or adjective + noun phrase) in every case the copy needs. */
export type Noun = {
  gender: NounGender
  /** Именительный, ед.: тренировка / занятие. */
  nom: string
  /** Родительный, ед.: тренировки / занятия. Also the «2–4» counting form. */
  gen: string
  /** Дательный, ед.: тренировке / занятию. */
  dat: string
  /** Винительный, ед.: тренировку / занятие. */
  acc: string
  /** Творительный, ед.: тренировкой / занятием. */
  ins: string
  /** Предложный, ед.: (на) тренировке / занятии. */
  prep: string
  /** Именительный, мн.: тренировки / занятия. */
  nomPl: string
  /** Родительный, мн.: тренировок / занятий. Also the «5+» counting form. */
  genPl: string
  /** Дательный, мн.: тренировкам / занятиям. */
  datPl: string
  /** Творительный, мн.: тренировками / занятиями. */
  insPl: string
  /** Предложный, мн.: (на) тренировках / занятиях. */
  prepPl: string
}

/** A class noun: feminine «тренировка» or neuter «занятие». */
export type SessionNoun = Noun & { gender: "f" | "n" }

export type ClubVocabulary = {
  /** One class on the schedule: «тренировка» / «занятие». */
  session: SessionNoun
  /** A one-on-one class: «персональная тренировка» / «индивидуальное занятие». */
  personalSession: SessionNoun
  /** The one-word tag of a one-on-one class: «персональная» / «индивидуальное». */
  personalTag: string
  /** Who leads a class (role `coach`): «тренер» / «педагог» / «преподаватель». */
  coach: Noun
  /** Role `head_coach`: «главный тренер» / «главный педагог». */
  headCoach: Noun
  /** Call to come regularly: «Тренируйтесь» / «Занимайтесь». */
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
  "f",
  ["тренировка", "тренировки", "тренировке", "тренировку", "тренировкой", "тренировке"],
  ["тренировки", "тренировок", "тренировкам", "тренировками", "тренировках"],
)

const CLASS = noun(
  "n",
  ["занятие", "занятия", "занятию", "занятие", "занятием", "занятии"],
  ["занятия", "занятий", "занятиям", "занятиями", "занятиях"],
)

const PERSONAL_TRAINING = noun(
  "f",
  [
    "персональная тренировка",
    "персональной тренировки",
    "персональной тренировке",
    "персональную тренировку",
    "персональной тренировкой",
    "персональной тренировке",
  ],
  [
    "персональные тренировки",
    "персональных тренировок",
    "персональным тренировкам",
    "персональными тренировками",
    "персональных тренировках",
  ],
)

const PERSONAL_CLASS = noun(
  "n",
  [
    "индивидуальное занятие",
    "индивидуального занятия",
    "индивидуальному занятию",
    "индивидуальное занятие",
    "индивидуальным занятием",
    "индивидуальном занятии",
  ],
  [
    "индивидуальные занятия",
    "индивидуальных занятий",
    "индивидуальным занятиям",
    "индивидуальными занятиями",
    "индивидуальных занятиях",
  ],
)

// Staff nouns are animate: the accusative matches the genitive.
const COACH = noun(
  "m",
  ["тренер", "тренера", "тренеру", "тренера", "тренером", "тренере"],
  ["тренеры", "тренеров", "тренерам", "тренерами", "тренерах"],
)
const TEACHER = noun(
  "m",
  ["педагог", "педагога", "педагогу", "педагога", "педагогом", "педагоге"],
  ["педагоги", "педагогов", "педагогам", "педагогами", "педагогах"],
)
const INSTRUCTOR = noun(
  "m",
  ["преподаватель", "преподавателя", "преподавателю", "преподавателя", "преподавателем", "преподавателе"],
  ["преподаватели", "преподавателей", "преподавателям", "преподавателями", "преподавателях"],
)

const head = (n: Noun): Noun =>
  noun(
    "m",
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
  personalTag: "персональная",
  coach: COACH,
  headCoach: head(COACH),
  practiceImperative: "Тренируйтесь",
}

const DANCE: ClubVocabulary = {
  session: CLASS,
  personalSession: PERSONAL_CLASS,
  personalTag: "индивидуальное",
  coach: TEACHER,
  headCoach: head(TEACHER),
  practiceImperative: "Занимайтесь",
}

const YOGA: ClubVocabulary = {
  session: CLASS,
  personalSession: PERSONAL_CLASS,
  personalTag: "индивидуальное",
  coach: INSTRUCTOR,
  headCoach: head(INSTRUCTOR),
  practiceImperative: "Занимайтесь",
}

const CUSTOM: ClubVocabulary = {
  session: CLASS,
  personalSession: PERSONAL_CLASS,
  personalTag: "индивидуальное",
  coach: COACH,
  headCoach: head(COACH),
  practiceImperative: "Занимайтесь",
}

/**
 * The vocabulary of a club by its `Workspace.type` (case-insensitive).
 * GRAPPLING and FITNESS keep «тренировка / тренер»; so does an unknown or
 * missing type, which is what every screen said before the vocabulary existed.
 */
export const vocabularyForWorkspaceType = (
  type: string | null | undefined,
): ClubVocabulary => {
  switch ((type ?? "").toUpperCase()) {
    case "DANCE":
      return DANCE
    case "YOGA":
      return YOGA
    case "CUSTOM":
      return CUSTOM
    default:
      return SPORT
  }
}

/** The adjective/participle form that agrees with a class noun's gender. */
export const agree = (noun: SessionNoun, feminine: string, neuter: string): string =>
  noun.gender === "n" ? neuter : feminine

/** First letter upper-cased, for a noun that opens a sentence or a title. */
export const cap = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)

/**
 * When a «срок с первого визита» abonement starts: «с первой тренировки» /
 * «с первого занятия».
 */
export const fromFirstSession = (vocabulary: ClubVocabulary): string =>
  `с ${agree(vocabulary.session, "первой", "первого")} ${vocabulary.session.gen}`

/**
 * The counting form after a number: 1 и 21 занятие, 2–4 занятия, 5–20 и 11–14
 * занятий. Callers pass their app's `pluralRu`, so the plural rule lives in one
 * place per app.
 */
export const countForm = (
  n: number,
  noun: Noun,
  pluralRu: (n: number, one: string, few: string, many: string) => string,
): string => pluralRu(n, noun.nom, noun.gen, noun.genPl)
