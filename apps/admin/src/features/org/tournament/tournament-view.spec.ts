import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  DIVISION_STATE_LABEL,
  ageLabel,
  competitorName,
  divisionPreviewName,
  formatKg,
  levelRangeLabel,
  levelWord,
  methodHasNote,
  methodHasScore,
  methodLabel,
  methodShort,
  nextRoundPhrase,
  parseKg,
  parseWeightBands,
  primaryAction,
  resultsCsv,
  secondaryAction,
  startConfirmText,
  statusLine,
  undoEffectText,
  weightBandLabel,
  weightLine,
  type TournamentSummary,
} from "./tournament-view"

const BJJ = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")

describe("weights", () => {
  it("formats kg with one decimal and a comma", () => {
    expect(formatKg(77.4)).toBe("77,4")
    expect(formatKg(76)).toBe("76,0")
    expect(formatKg(100.05)).toMatch(/^100,[01]$/)
  })

  it("parses what the scale shows, comma or dot, at most one decimal", () => {
    expect(parseKg("77,4")).toBe(77.4)
    expect(parseKg(" 77.4 ")).toBe(77.4)
    expect(parseKg("77")).toBe(77)
    for (const bad of ["", "77,45", "abc", "-5", "1000"]) expect(parseKg(bad)).toBeNull()
  })

  it("shows declared → weighed, either alone, or nothing after retention", () => {
    expect(weightLine(76, 77.4)).toBe("76,0 → 77,4 кг")
    expect(weightLine(76, null)).toBe("76,0 кг")
    expect(weightLine(null, 77.4)).toBe("77,4 кг")
    expect(weightLine(null, null)).toBeNull()
  })
})

describe("«Добавить категории»", () => {
  it("turns «64 70 76 82 +82» into five bands", () => {
    expect(parseWeightBands("64 70 76 82 +82")).toEqual({
      bands: [
        { minKg: null, maxKg: 64 },
        { minKg: 64, maxKg: 70 },
        { minKg: 70, maxKg: 76 },
        { minKg: 76, maxKg: 82 },
        { minKg: 82, maxKg: null },
      ],
    })
  })

  it("reads an empty field as one open weight and refuses disorder", () => {
    expect(parseWeightBands("  ")).toEqual({ bands: [{ minKg: null, maxKg: null }] })
    expect(parseWeightBands("70 64")).toEqual({ error: "Веса идут по возрастанию" })
    expect(parseWeightBands("+70 76")).toEqual({ error: "«+» ставится только у последнего веса" })
    expect(parseWeightBands("70 кг")).toEqual({ error: "Не вес: «кг»" })
    expect(parseWeightBands("57,5")).toEqual({ bands: [{ minKg: null, maxKg: 57.5 }] })
  })

  it("names a division in the server's order", () => {
    expect(
      divisionPreviewName({ sex: "MALE", ageMin: 18, ageMax: 35, levelLabel: "Синий – коричневый", minKg: 70, maxKg: 76 }),
    ).toBe("Мужчины · 18–35 лет · Синий – коричневый · до 76 кг")
    expect(divisionPreviewName({ sex: null, ageMin: null, ageMax: null, levelLabel: null, minKg: 94, maxKg: null })).toBe(
      "св. 94 кг",
    )
    expect(divisionPreviewName({ sex: "FEMALE", ageMin: 8, ageMax: 9, levelLabel: null, minKg: null, maxKg: null })).toBe(
      "Женщины · 8–9 лет · абсолютная",
    )
    expect(weightBandLabel({ minKg: null, maxKg: 57.5 })).toBe("до 57,5 кг")
  })

  it("labels ages and level ranges", () => {
    expect(ageLabel(18, null)).toBe("от 18 лет")
    expect(ageLabel(null, 35)).toBe("до 35 лет")
    expect(ageLabel(10, 10)).toBe("10 лет")
    expect(ageLabel(null, null)).toBeNull()
    expect(levelRangeLabel("Синий", "Коричневый")).toBe("Синий – Коричневый")
    expect(levelRangeLabel("Синий", "Синий")).toBe("Синий")
    expect(levelRangeLabel(null, null)).toBeNull()
    expect(levelWord("GRAPPLING")).toBe("Пояс")
    expect(levelWord("YOGA")).toBe("Уровень")
  })
})

describe("division state", () => {
  it("reads нет сетки → сетка → идёт → итоги", () => {
    expect([DIVISION_STATE_LABEL.NOT_DRAWN, DIVISION_STATE_LABEL.DRAWN, DIVISION_STATE_LABEL.RUNNING, DIVISION_STATE_LABEL.FINISHED]).toEqual([
      "нет сетки",
      "сетка",
      "идёт",
      "итоги",
    ])
  })
})

const summary = (over: Partial<TournamentSummary> & { counts?: Partial<TournamentSummary["counts"]> } = {}): TournamentSummary => ({
  status: over.status ?? "SETUP",
  resultsPublishedAt: over.resultsPublishedAt ?? null,
  counts: {
    registrations: 23,
    declared: 3,
    confirmed: 12,
    weighed: 0,
    unweighed: 12,
    unassigned: 0,
    divisions: 8,
    divisionsDrawn: 0,
    divisionsFinished: 0,
    ...over.counts,
  },
})

describe("tournament header", () => {
  it("writes one status line per phase", () => {
    expect(statusLine(summary(), BJJ)).toBe("Приём заявок · подтверждено 12 из 23 · ждут тренера 3")
    expect(statusLine(summary(), DANCE)).toBe("Приём заявок · подтверждено 12 из 23 · ждут педагога 3")
    expect(statusLine(summary({ counts: { declared: 0 } }), BJJ)).toBe("Приём заявок · подтверждено 12 из 23")
    expect(statusLine(summary({ status: "WEIGH_IN", counts: { weighed: 46, unweighed: 6 } }), BJJ)).toBe(
      "Взвешивание · взвешено 46 из 52",
    )
    expect(statusLine(summary({ status: "RUNNING", counts: { divisionsDrawn: 8, divisionsFinished: 3 } }), BJJ)).toBe(
      "Идёт · категорий с итогами 3 из 8",
    )
    expect(statusLine(summary({ status: "FINISHED", resultsPublishedAt: "2026-10-12T12:00:00.000Z" }), BJJ)).toBe(
      "Итоги опубликованы 12 октября",
    )
  })

  it("offers one primary per phase; publishing is the admin's and waits for every division", () => {
    expect(primaryAction(summary(), false)?.label).toBe("Начать взвешивание")
    expect(primaryAction(summary({ status: "WEIGH_IN" }), false)?.label).toBe("Начать турнир")
    const done = summary({ status: "RUNNING", counts: { divisionsDrawn: 8, divisionsFinished: 8 } })
    expect(primaryAction(done, true)?.action).toBe("publish")
    expect(primaryAction(done, false)).toBeNull()
    expect(primaryAction(summary({ status: "RUNNING", counts: { divisionsDrawn: 8, divisionsFinished: 7 } }), true)).toBeNull()
    expect(primaryAction(summary({ status: "FINISHED" }), true)).toBeNull()
  })

  it("keeps the step back quiet: reopen entries at weigh-in, unpublish for admins", () => {
    expect(secondaryAction(summary({ status: "WEIGH_IN" }), false)?.label).toBe("Вернуть приём заявок")
    expect(secondaryAction(summary({ status: "FINISHED" }), true)?.label).toBe("Снять публикацию")
    expect(secondaryAction(summary({ status: "FINISHED" }), false)).toBeNull()
    expect(secondaryAction(summary(), true)).toBeNull()
  })

  it("names everyone the start withdraws: unweighed and still waiting for the coach", () => {
    expect(startConfirmText(summary({ status: "WEIGH_IN", counts: { unweighed: 2, declared: 3 } }))).toMatch(
      /^Не взвешены 5 участников — их снимут с турнира/,
    )
    expect(startConfirmText(summary({ status: "WEIGH_IN", counts: { unweighed: 0, declared: 0 } }))).toMatch(
      /^Сетки соберутся/,
    )
  })
})

describe("competitors and undo", () => {
  it("hides a person without consent", () => {
    expect(competitorName({ hidden: true, personName: null })).toBe("Участник скрыт")
    expect(competitorName({ hidden: false, personName: "Иванов" })).toBe("Иванов")
    expect(competitorName(null)).toBe("—")
  })

  it("names where the winner went, or the places after a final", () => {
    expect(nextRoundPhrase(1, 4)).toBe("в четвертьфинал")
    expect(nextRoundPhrase(2, 4)).toBe("в полуфинал")
    expect(nextRoundPhrase(3, 4)).toBe("в финал")
    expect(nextRoundPhrase(1, 5)).toBe("в 1/8 финала")
    expect(undoEffectText("Иванов", 2, 3)).toBe("Выход в финал тоже отменится (Иванов).")
    expect(undoEffectText("Иванов", 3, 3)).toBe("Места в категории тоже снимутся.")
  })
})

describe("match methods", () => {
  it("names the finish in the discipline's words", () => {
    expect(methodLabel("FINISH", "GRAPPLING")).toBe("Болевой/удушающий")
    expect(methodLabel("FINISH", "FITNESS")).toBe("Досрочная победа")
    expect(methodLabel("WALKOVER", "GRAPPLING")).toBe("Неявка")
  })

  it("asks scores only for points and decision, the technique only for a finish", () => {
    expect(["FINISH", "POINTS", "DECISION", "DISQUALIFICATION", "WALKOVER"].map((m) => methodHasScore(m as never))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ])
    expect(methodHasNote("FINISH")).toBe(true)
    expect(methodHasNote("POINTS")).toBe(false)
    expect(methodHasScore(null)).toBe(false)
  })

  it("writes the short tail with the winner's score first", () => {
    const m = { method: "POINTS" as const, scoreA: 2, scoreB: 8, note: null }
    expect(methodShort(m, "B", "GRAPPLING")).toBe("8:2")
    expect(methodShort(m, "A", "GRAPPLING")).toBe("2:8")
    expect(methodShort({ method: "FINISH", scoreA: null, scoreB: null, note: "Рычаг локтя" }, "A", "GRAPPLING")).toBe(
      "Рычаг локтя",
    )
    expect(methodShort({ method: "FINISH", scoreA: null, scoreB: null, note: null }, "A", "GRAPPLING")).toBe("болевой")
    expect(methodShort({ method: "DECISION", scoreA: null, scoreB: null, note: null }, "A", null)).toBe("решение судей")
    expect(methodShort({ method: "WALKOVER", scoreA: null, scoreB: null, note: null }, "A", null)).toBe("неявка")
    expect(methodShort({ method: null, scoreA: null, scoreB: null, note: null }, null, null)).toBeNull()
  })
})

describe("protocol CSV", () => {
  it("lists finished divisions' podiums by place, `;`-separated with a BOM", () => {
    const csv = resultsCsv([
      {
        name: "до 76 кг",
        finished: true,
        podium: [
          { place: 3, personName: "Петров", clubName: "Беркут" },
          { place: 1, personName: "Иванов", clubName: "ACADEMY" },
          { place: 2, personName: "Участник скрыт", clubName: null },
        ],
      },
      { name: "до 82 кг", finished: false, podium: [] },
    ])
    expect(csv).toBe(
      "\uFEFFКатегория;Место;Участник;Клуб\r\nдо 76 кг;1;Иванов;ACADEMY\r\nдо 76 кг;2;Участник скрыт;\r\nдо 76 кг;3;Петров;Беркут\r\n",
    )
  })
})
