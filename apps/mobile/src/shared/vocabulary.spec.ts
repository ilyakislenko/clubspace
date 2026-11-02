import {
  agree,
  countForm,
  fromFirstSession,
  vocabularyForWorkspaceType,
} from "@clubspace/ui-kit/brand"

import { pluralRu } from "./format-ru"
import { formatRoleName } from "./role-labels"

const counted = (type: string, n: number) =>
  `${n} ${countForm(n, vocabularyForWorkspaceType(type).session, pluralRu)}`

describe("club vocabulary", () => {
  it("keeps the academy's «тренировка / тренер» for grappling and fitness", () => {
    for (const type of ["GRAPPLING", "FITNESS"]) {
      const v = vocabularyForWorkspaceType(type)
      expect([v.session.nom, v.coach.nom, v.headCoach.nom]).toEqual([
        "тренировка",
        "тренер",
        "главный тренер",
      ])
    }
  })

  it("gives a dance studio «занятие / педагог» and yoga «занятие / преподаватель»", () => {
    const dance = vocabularyForWorkspaceType("DANCE")
    expect([dance.session.nom, dance.coach.nom, dance.headCoach.nom]).toEqual([
      "занятие",
      "педагог",
      "главный педагог",
    ])
    const yoga = vocabularyForWorkspaceType("YOGA")
    expect([yoga.session.nom, yoga.coach.nom]).toEqual(["занятие", "преподаватель"])
    const custom = vocabularyForWorkspaceType("CUSTOM")
    expect([custom.session.nom, custom.coach.nom]).toEqual(["занятие", "тренер"])
  })

  it("falls back to the academy's words for an unknown or missing type", () => {
    expect(vocabularyForWorkspaceType(undefined).session.nom).toBe("тренировка")
    expect(vocabularyForWorkspaceType("dance").session.nom).toBe("занятие")
  })

  it("declines a class after a number: 1, 2, 5, 11, 21", () => {
    expect([1, 2, 5, 11, 21].map((n) => counted("DANCE", n))).toEqual([
      "1 занятие",
      "2 занятия",
      "5 занятий",
      "11 занятий",
      "21 занятие",
    ])
    expect([1, 2, 5, 11, 21].map((n) => counted("GRAPPLING", n))).toEqual([
      "1 тренировка",
      "2 тренировки",
      "5 тренировок",
      "11 тренировок",
      "21 тренировка",
    ])
  })

  it("agrees words with the class noun's gender", () => {
    const dance = vocabularyForWorkspaceType("DANCE").session
    const sport = vocabularyForWorkspaceType("GRAPPLING").session
    expect(`${agree(dance, "Ближайшая", "Ближайшее")} ${dance.nom}`).toBe("Ближайшее занятие")
    expect(`${agree(sport, "Ближайшая", "Ближайшее")} ${sport.nom}`).toBe("Ближайшая тренировка")
    expect(fromFirstSession(vocabularyForWorkspaceType("DANCE"))).toBe("с первого занятия")
    expect(fromFirstSession(vocabularyForWorkspaceType("FITNESS"))).toBe("с первой тренировки")
  })

  it("names staff roles in the club's words", () => {
    const dance = vocabularyForWorkspaceType("DANCE")
    expect(formatRoleName("coach", dance)).toBe("Педагог")
    expect(formatRoleName("head_coach", dance)).toBe("Главный педагог")
    expect(formatRoleName("user", dance)).toBe("Ученик")
    expect(formatRoleName("head_coach", vocabularyForWorkspaceType("GRAPPLING"))).toBe(
      "Главный тренер",
    )
  })
})
