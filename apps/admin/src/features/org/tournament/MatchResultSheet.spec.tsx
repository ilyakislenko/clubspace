/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../../shared/api/tournaments", () => ({
  getTournamentBracket: jest.fn(),
  recordTournamentMatchResult: jest.fn(),
  undoTournamentMatchResult: jest.fn(),
}))

import {
  getTournamentBracket,
  recordTournamentMatchResult,
  undoTournamentMatchResult,
  type TournamentBracket,
  type TournamentMatch,
} from "../../../shared/api/tournaments"
import { ConfirmDialogHost } from "../../../shared/ui/confirm-dialog"
import { MatchResultSheet } from "./MatchResultSheet"

const recordMock = recordTournamentMatchResult as jest.Mock
const undoMock = undoTournamentMatchResult as jest.Mock
const bracketMock = getTournamentBracket as jest.Mock

const A = { entryId: "e-a", hidden: false, personName: "Иванов Максим", clubName: "ACADEMY", place: null }
const B = { entryId: "e-b", hidden: false, personName: "Петров Пётр", clubName: "Беркут", place: null }

const match = (over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id: "m1",
  divisionId: "d1",
  round: 2,
  position: 1,
  isBye: false,
  entryA: A,
  entryB: B,
  winnerEntryId: null,
  method: null,
  scoreA: null,
  scoreB: null,
  note: null,
  decidedAt: null,
  ready: true,
  nextMatchId: "m-final",
  updatedAt: "2026-11-27T10:00:00.000Z",
  ...over,
})

const bracketWith = (m: TournamentMatch): TournamentBracket =>
  ({ division: { id: "d1" }, size: 8, rounds: 3, matches: [m], entries: [] }) as unknown as TournamentBracket

const httpError = (status: number, code: string, message: string) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message } } })

const renderSheet = (m: TournamentMatch, canEdit = true) => {
  const onRecorded = jest.fn()
  const onUndone = jest.fn()
  render(
    <>
      <MatchResultSheet
        organizationId="o1"
        tournamentId="t1"
        orgType="GRAPPLING"
        match={m}
        divisionName="Мужчины · до 82 кг"
        rounds={3}
        canEdit={canEdit}
        onClose={jest.fn()}
        onRecorded={onRecorded}
        onUndone={onUndone}
      />
      <ConfirmDialogHost />
    </>,
  )
  return { onRecorded, onUndone }
}

const pick = (name: RegExp | string) => fireEvent.click(screen.getByRole("radio", { name }))

beforeEach(() => jest.clearAllMocks())

describe("MatchResultSheet", () => {
  it("asks scores only for points and decision, the technique only for a finish", () => {
    renderSheet(match())
    expect(screen.getByText("1/2 · Мужчины · до 82 кг")).toBeTruthy()
    expect(screen.queryByLabelText("Иванов Максим")).toBeNull()
    pick("Болевой/удушающий")
    expect(screen.getByLabelText("Приём")).toBeTruthy()
    expect(screen.queryByLabelText("Иванов Максим")).toBeNull()
    pick("По очкам")
    expect(screen.getByLabelText("Иванов Максим")).toBeTruthy()
    expect(screen.getByLabelText("Петров Пётр")).toBeTruthy()
    expect(screen.queryByLabelText("Приём")).toBeNull()
    pick("Решение судей")
    expect(screen.getByLabelText("Иванов Максим")).toBeTruthy()
    for (const method of ["Дисквалификация", "Неявка"]) {
      pick(method)
      expect(screen.queryByLabelText("Иванов Максим")).toBeNull()
      expect(screen.queryByLabelText("Приём")).toBeNull()
    }
  })

  it("records winner, method and score with the version it opened with", async () => {
    const saved = match({ winnerEntryId: "e-b", method: "POINTS", scoreA: 2, scoreB: 8, updatedAt: "2026-11-27T10:05:00.000Z" })
    recordMock.mockResolvedValue(bracketWith(saved))
    const { onRecorded } = renderSheet(match())
    const save = screen.getByRole("button", { name: "Записать" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: /Петров Пётр/ }))
    pick("По очкам")
    fireEvent.change(screen.getByLabelText("Иванов Максим"), { target: { value: "2" } })
    expect(screen.getByText("Укажите счёт обоих")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Петров Пётр"), { target: { value: "1" } })
    expect(screen.getByText("При победе по очкам у победителя счёт больше")).toBeTruthy()
    expect(save.disabled).toBe(true)
    // A judges' decision may follow a tie or a lower score.
    pick("Решение судей")
    expect(screen.queryByText("При победе по очкам у победителя счёт больше")).toBeNull()
    pick("По очкам")
    fireEvent.change(screen.getByLabelText("Петров Пётр"), { target: { value: "8" } })
    fireEvent.click(save)
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(recordMock.mock.calls[0][0]).toEqual({
      organizationId: "o1",
      tournamentId: "t1",
      matchId: "m1",
      data: {
        winnerEntryId: "e-b",
        method: "POINTS",
        scoreA: 2,
        scoreB: 8,
        note: null,
        expectedUpdatedAt: "2026-11-27T10:00:00.000Z",
      },
    })
    expect(onRecorded.mock.calls[0][0]).toMatchObject({ match: saved, winnerName: "Петров Пётр" })
  })

  it("on STALE_UPDATE shows what the other tablet recorded, and «Обновить» opens it read-only", async () => {
    recordMock.mockRejectedValue(httpError(409, "STALE_UPDATE", "Результат уже записан с другого планшета"))
    const stored = match({ winnerEntryId: "e-a", method: "FINISH", note: "Рычаг локтя", decidedAt: "2026-11-27T10:01:00.000Z" })
    bracketMock.mockResolvedValue(bracketWith(stored))
    renderSheet(match())
    fireEvent.click(screen.getByRole("radio", { name: /Петров Пётр/ }))
    pick("Неявка")
    fireEvent.click(screen.getByRole("button", { name: "Записать" }))
    expect(await screen.findByText("Результат уже записан с другого планшета")).toBeTruthy()
    expect(
      await screen.findByText("Записано: Победа: Иванов Максим · Болевой/удушающий · Рычаг локтя"),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }))
    expect(await screen.findByRole("button", { name: "Отменить результат" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Записать" })).toBeNull()
  })

  it("undoes a decided match after a confirm naming the next round; a blocked undo shows the server's words", async () => {
    undoMock.mockRejectedValueOnce(
      httpError(409, "MATCH_UNDO_BLOCKED", "Сначала отмените схватку Иванов — Сидоров"),
    )
    const decided = match({ winnerEntryId: "e-a", method: "DECISION", scoreA: 3, scoreB: 3 })
    const { onUndone } = renderSheet(decided)
    expect(screen.getByText("Победа: Иванов Максим · Решение судей · 3:3")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Отменить результат" }))
    const dialog = await screen.findByRole("dialog", { name: "Отменить результат?" })
    expect(within(dialog).getByText("Выход в финал тоже отменится (Иванов Максим).")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить результат" }))
    expect(await screen.findByText("Сначала отмените схватку Иванов — Сидоров")).toBeTruthy()
    expect(undoMock.mock.calls[0][0]).toEqual({
      organizationId: "o1",
      tournamentId: "t1",
      matchId: "m1",
      expectedUpdatedAt: "2026-11-27T10:00:00.000Z",
    })
    expect(onUndone).not.toHaveBeenCalled()
  })

  it("only shows a decided match outside RUNNING (no undo after publication)", () => {
    renderSheet(match({ winnerEntryId: "e-a", method: "WALKOVER" }), false)
    expect(screen.getByText("Победа: Иванов Максим · Неявка")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Отменить результат" })).toBeNull()
  })
})
