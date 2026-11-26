import type { ClubOrgEvent } from "../../shared/api/organizations"
import type { ClubTournament, ClubTournamentAthlete, ClubTournamentEntry, ClubTournamentPerson } from "../../shared/api/tournaments"
import {
  aheadLabel,
  athleteCategoryLine,
  athleteRowKind,
  athleteStatusLabel,
  entryStateLine,
  entryWeightsLine,
  eventTournamentLine,
  formatKg,
  HIDDEN_PERSON,
  initialRound,
  isEliminated,
  matchResultShort,
  nextMatchLines,
  parseKgInput,
  pendingSlotLabel,
  personLabel,
  podiumLines,
  roundLabel,
  sortAthletes,
  tournamentSections,
  tournamentStatusLine,
} from "./tournament-helpers"

// The club's word for a coach, as useVocabulary gives it.
const COACH = { gen: "тренера" }
const TEACHER = { gen: "педагога" }
const person = (o: Partial<ClubTournamentPerson> = {}): ClubTournamentPerson => ({
  hidden: false,
  personName: "Пётр Сидоров",
  clubName: "Беркут",
  isMe: false,
  isMyClub: false,
  ...o,
})

const entry = (o: Partial<ClubTournamentEntry> = {}): ClubTournamentEntry => ({
  id: "e-1",
  userId: "u-1",
  status: "CONFIRMED",
  sex: "MALE",
  birthYear: 1997,
  declaredWeightKg: 77.4,
  weighedWeightKg: null,
  divisionId: "d-1",
  divisionName: "Мужчины · от 18 лет · Белый · до 82 кг",
  levelName: "Белый",
  withdrawnReason: null,
  place: null,
  bracketAvailable: false,
  nextMatch: null,
  updatedAt: "2026-11-27T05:00:00.000Z",
  ...o,
})

const tournament = (o: Partial<ClubTournament> = {}): ClubTournament =>
  ({
    id: "t-1",
    eventId: "ev-1",
    organizationId: "o-1",
    organizationName: "Федерация БЖЖ Томской области",
    eventTitle: "Кубок федерации, 2-й этап",
    status: "SETUP",
    matCount: 3,
    resultsPublishedAt: null,
    myRegistrationId: "r-1",
    myEntry: null,
    canDeclare: false,
    profileBirthYear: 1997,
    consentCurrent: true,
    consentText: "…",
    consentVersion: "2026-11-27.1",
    levels: [],
    toConfirmCount: null,
    ...o,
  }) as ClubTournament

const athlete = (o: Partial<ClubTournamentAthlete> = {}): ClubTournamentAthlete =>
  ({
    userId: "u-2",
    name: "Иван Петров",
    registrationId: "r-2",
    consentCurrent: true,
    profileBirthYear: 2001,
    registryLevel: null,
    entry: null,
    ...o,
  }) as ClubTournamentAthlete

describe("weights", () => {
  it("formats kg the Russian way", () => {
    expect(formatKg(77.4)).toBe("77,4")
    expect(formatKg(76)).toBe("76")
  })

  it.each([
    ["77,4", 77.4],
    ["77.4", 77.4],
    [" 82 ", 82],
    ["10", 10],
    ["250", 250],
    ["9,9", null],
    ["250,1", null],
    ["77,45", null],
    ["семьдесят", null],
    ["", null],
  ])("parses %j → %j", (raw, kg) => {
    expect(parseKgInput(raw)).toBe(kg)
  })

  it("shows the declared and the weighed weight, nothing after the retention", () => {
    expect(entryWeightsLine(entry({ weighedWeightKg: 77.9 }))).toBe("Заявлено 77,4 кг · на весах 77,9 кг")
    expect(entryWeightsLine(entry())).toBe("Заявлено 77,4 кг")
    expect(entryWeightsLine(entry({ declaredWeightKg: null }))).toBeNull()
  })
})

describe("the Events row line", () => {
  const row = (o: Partial<Pick<ClubOrgEvent, "tournament" | "myEntryState">>) =>
    ({ tournament: { id: "t-1", status: "SETUP", toConfirmCount: null }, myEntryState: null, ...o }) as Pick<
      ClubOrgEvent,
      "tournament" | "myEntryState"
    >
  const state = (o: Partial<NonNullable<ClubOrgEvent["myEntryState"]>>) => ({
    state: "CONFIRMED" as const,
    divisionName: null,
    mat: null,
    ahead: null,
    place: null,
    ...o,
  })

  it("is nothing without a tournament or an entry", () => {
    expect(eventTournamentLine(row({ tournament: null }), false, COACH)).toBeNull()
    expect(eventTournamentLine(row({}), false, COACH)).toBeNull()
  })

  it.each([
    [state({ state: "NEEDS_WEIGHT" }), "Укажите вес для заявки"],
    [state({ state: "AWAITING_COACH" }), "Заявка у тренера"],
    [state({ state: "WITHDRAWN" }), "Заявка снята"],
    [state({ divisionName: "до 76 кг" }), "до 76 кг"],
    [state({}), "Категорию назначит федерация"],
    [state({ divisionName: "до 76 кг", mat: 2, ahead: 2 }), "Ковёр 2 · перед вами 2 схватки"],
    [state({ divisionName: "до 76 кг", mat: 2, ahead: 0 }), "Ковёр 2 · ваша схватка следующая"],
    [state({ divisionName: "до 76 кг", mat: 2, ahead: 2, place: 2 }), "2 место"],
  ])("member %j → %s", (myEntryState, line) => {
    expect(eventTournamentLine(row({ myEntryState }), false, COACH)).toBe(line)
  })

  it("speaks the club's word for the coach", () => {
    expect(eventTournamentLine(row({ myEntryState: state({ state: "AWAITING_COACH" }) }), false, TEACHER)).toBe(
      "Заявка у педагога",
    )
  })

  it("tells a coach how many entries wait for them, nothing at zero", () => {
    expect(eventTournamentLine(row({ tournament: { id: "t", status: "SETUP", toConfirmCount: 3 } }), true, COACH)).toBe(
      "Ждут подтверждения: 3",
    )
    expect(eventTournamentLine(row({ tournament: { id: "t", status: "SETUP", toConfirmCount: 0 } }), true, COACH)).toBeNull()
  })
})

describe("the next match", () => {
  it.each([
    [0, "ваша схватка следующая"],
    [1, "перед вами 1 схватка"],
    [2, "перед вами 2 схватки"],
    [5, "перед вами 5 схваток"],
    [21, "перед вами 21 схватка"],
  ])("ahead %i → %s", (ahead, label) => {
    expect(aheadLabel(ahead)).toBe(label)
  })

  it("names the mat, the queue and the opponent with the club", () => {
    expect(nextMatchLines({ mat: 2, ahead: 1, opponent: person(), waitingFor: null })).toEqual({
      where: "Ковёр 2 · перед вами 1 схватка",
      opponent: "Соперник: Пётр Сидоров (Беркут)",
    })
  })

  it("waits for the winner of the feeding match", () => {
    expect(
      nextMatchLines({
        mat: 2,
        ahead: null,
        opponent: null,
        waitingFor: { entryA: person({ personName: "Петров" }), entryB: person({ hidden: true, personName: null, clubName: null }) },
      }),
    ).toEqual({ where: "Ковёр 2", opponent: `Соперник — победитель схватки Петров — ${HIDDEN_PERSON}` })
  })

  it("says when the division has no mat yet", () => {
    expect(nextMatchLines({ mat: null, ahead: null, opponent: person(), waitingFor: null }).where).toBe("Ковёр не назначен")
  })

  it("hides a person without consent, club included", () => {
    expect(personLabel(person({ hidden: true, personName: null, clubName: null }))).toBe("Участник скрыт")
    expect(personLabel(person({ clubName: null }))).toBe("Пётр Сидоров")
    expect(personLabel(null)).toBe("Участник скрыт")
  })
})

describe("the tournament screen", () => {
  it.each([
    ["SETUP", "Приём заявок"],
    ["WEIGH_IN", "Взвешивание"],
    ["RUNNING", "Идёт · 3 ковра"],
    ["FINISHED", "Итоги опубликованы"],
  ] as const)("status %s → %s", (status, line) => {
    expect(tournamentStatusLine({ status, matCount: 3 })).toBe(line)
  })

  it("words the entry: waiting, the division, none yet, withdrawn", () => {
    expect(entryStateLine(entry({ status: "DECLARED" }), COACH)).toBe("Заявка у тренера")
    expect(entryStateLine(entry(), COACH)).toBe("Мужчины · от 18 лет · Белый · до 82 кг")
    expect(entryStateLine(entry({ divisionName: null }), COACH)).toBe("Категорию назначит федерация")
    expect(entryStateLine(entry({ status: "WITHDRAWN", withdrawnReason: "Не взвешен" }), COACH)).toBe("Заявка снята: Не взвешен")
  })

  it("shows only the true sections for a member", () => {
    expect(tournamentSections(tournament({ canDeclare: true }), false)).toMatchObject({
      declare: true,
      entry: false,
      nextMatch: false,
      bracket: false,
      results: false,
      toConfirm: false,
      athletes: false,
    })
    const running = tournament({
      status: "RUNNING",
      myEntry: entry({ bracketAvailable: true, nextMatch: { mat: 2, ahead: 1, opponent: person(), waitingFor: null } }),
    })
    expect(tournamentSections(running, false)).toMatchObject({ declare: false, entry: true, nextMatch: true, bracket: true, place: false, eliminated: false })
    const placed = tournament({ status: "FINISHED", myEntry: entry({ bracketAvailable: true, place: 3 }) })
    expect(tournamentSections(placed, false)).toMatchObject({ nextMatch: false, place: true, eliminated: false, results: true })
    const out = tournament({ status: "RUNNING", myEntry: entry({ bracketAvailable: true }) })
    expect(tournamentSections(out, false)).toMatchObject({ eliminated: true, place: false })
  })

  it("shows a coach the confirmations and the students, never the member's entry sections", () => {
    expect(tournamentSections(tournament({ toConfirmCount: 3, canDeclare: true }), true)).toMatchObject({
      declare: false,
      entry: false,
      toConfirm: true,
      athletes: true,
    })
    expect(tournamentSections(tournament({ toConfirmCount: 0 }), true).toConfirm).toBe(false)
  })

  it("never calls an undrawn entry eliminated", () => {
    expect(isEliminated(entry(), "RUNNING")).toBe(false)
    expect(isEliminated(entry({ bracketAvailable: true }), "SETUP")).toBe(false)
  })
})

describe("the coach's students", () => {
  it.each([
    [athlete({ registrationId: null }), "notBooked", "не записан"],
    [athlete(), "needsWeight", "нет веса"],
    [athlete({ entry: entry({ status: "DECLARED" }) }), "toConfirm", "ждёт подтверждения"],
    [athlete({ entry: entry() }), "confirmed", "Мужчины · от 18 лет · Белый · до 82 кг"],
    [athlete({ entry: entry({ status: "WITHDRAWN" }) }), "withdrawn", "Заявка снята"],
  ])("%#: kind and category line", (a, kind, line) => {
    expect(athleteRowKind(a)).toBe(kind)
    expect(athleteCategoryLine(a, COACH)).toBe(line)
  })

  it.each([
    [entry({ place: 1 }), "1 место"],
    [entry({ nextMatch: { mat: 2, ahead: 1, opponent: person(), waitingFor: null } }), "ковёр 2, через 1"],
    [entry({ nextMatch: { mat: 2, ahead: 0, opponent: person(), waitingFor: null } }), "ковёр 2, следующий"],
    [entry({ nextMatch: { mat: 3, ahead: null, opponent: null, waitingFor: null } }), "ковёр 3"],
    [entry({ bracketAvailable: true }), "выбыл"],
    [entry({ bracketAvailable: true, sex: "FEMALE" }), "выбыла"],
    [entry(), null],
  ])("%#: status label", (e, label) => {
    expect(athleteStatusLabel(athlete({ entry: e }), "RUNNING")).toBe(label)
  })

  it("puts the entries waiting for the coach first, then by name", () => {
    const list = [
      athlete({ name: "Яков", registrationId: null }),
      athlete({ name: "Борис" }),
      athlete({ name: "Анна", entry: entry({ status: "DECLARED" }) }),
      athlete({ name: "Вера", entry: entry() }),
    ]
    expect(sortAthletes(list).map((a) => a.name)).toEqual(["Анна", "Вера", "Борис", "Яков"])
  })
})

describe("the bracket", () => {
  it.each([
    [1, 1, "Финал"],
    [1, 2, "1/2"],
    [2, 2, "Финал"],
    [1, 3, "1/4"],
    [1, 4, "1/8"],
    [3, 4, "1/2"],
  ])("round %i of %i → %s", (round, rounds, label) => {
    expect(roundLabel(round, rounds)).toBe(label)
  })

  it("opens on the latest round with the viewer's athlete, else the first", () => {
    const m = (round: number, me: boolean) => ({ round, entryA: { isMe: me }, entryB: { isMe: false } })
    expect(initialRound([m(1, true), m(1, false), m(2, true), m(3, false)])).toBe(2)
    expect(initialRound([m(1, false), m(2, false)])).toBe(1)
  })

  it("names the match that fills an empty slot, «—» while that one waits too", () => {
    const m = (round: number, position: number, a: string | null, b: string | null) => ({
      round,
      position,
      entryA: a ? person({ personName: a }) : null,
      entryB: b ? person({ personName: b }) : null,
    })
    const matches = [
      m(1, 1, "Карпов", "Иванов"),
      m(1, 2, "Петров", null),
      m(1, 3, "Орлов", "Котов"),
      m(1, 4, "Носов", "Лосев"),
      m(2, 2, null, null),
    ]
    expect(pendingSlotLabel(matches, { round: 2, position: 1 }, "A")).toBe("победитель схватки Карпов — Иванов")
    expect(pendingSlotLabel(matches, { round: 2, position: 1 }, "B")).toBe("—")
    expect(pendingSlotLabel(matches, { round: 2, position: 2 }, "B")).toBe("победитель схватки Носов — Лосев")
    expect(pendingSlotLabel(matches, { round: 3, position: 1 }, "B")).toBe("—")
    expect(pendingSlotLabel([m(1, 1, "Карпов", null), m(1, 2, null, null)], { round: 2, position: 1 }, "A")).toBe(
      "—",
    )
  })

  it.each([
    [{ isBye: true, method: null, scoreA: null, scoreB: null }, null],
    [{ isBye: false, method: null, scoreA: null, scoreB: null }, null],
    [{ isBye: false, method: "POINTS", scoreA: 8, scoreB: 2 }, "8:2"],
    [{ isBye: false, method: "DECISION", scoreA: 2, scoreB: 2 }, "решение 2:2"],
    [{ isBye: false, method: "FINISH", scoreA: null, scoreB: null }, "досрочно"],
    [{ isBye: false, method: "WALKOVER", scoreA: null, scoreB: null }, "неявка"],
    [{ isBye: false, method: "DISQUALIFICATION", scoreA: null, scoreB: null }, "дисквалификация"],
  ] as const)("%j → %s", (m, label) => {
    expect(matchResultShort(m)).toBe(label)
  })
})

describe("«Мои пояса»", () => {
  it("lists podiums newest first, with place, tournament and date", () => {
    expect(
      podiumLines([
        { eventId: "e1", tournamentTitle: "Кубок федерации, 1-й этап", date: "2026-10-18", divisionName: "x", place: 3 },
        { eventId: "e2", tournamentTitle: "Открытый турнир", date: "2026-11-20", divisionName: "y", place: 1 },
      ]),
    ).toEqual([
      { eventId: "e2", line: "1 место — Открытый турнир · 20 ноября" },
      { eventId: "e1", line: "3 место — Кубок федерации, 1-й этап · 18 октября" },
    ])
  })
})
