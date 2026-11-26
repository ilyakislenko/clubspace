/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../../shared/api/tournaments", () => ({
  moveTournamentEntry: jest.fn(),
  recordTournamentWeighIn: jest.fn(),
  setTournamentEntryWithdrawn: jest.fn(),
}))

import {
  moveTournamentEntry,
  recordTournamentWeighIn,
  setTournamentEntryWithdrawn,
  type TournamentDivision,
  type TournamentEntry,
  type TournamentStatus,
} from "../../../shared/api/tournaments"
import { ConfirmDialogHost } from "../../../shared/ui/confirm-dialog"
import { WeighInSheet } from "./WeighInSheet"

const weighMock = recordTournamentWeighIn as jest.Mock
const moveMock = moveTournamentEntry as jest.Mock
const withdrawMock = setTournamentEntryWithdrawn as jest.Mock

const entry = (over: Partial<TournamentEntry> = {}): TournamentEntry => ({
  id: "e1",
  hidden: false,
  personName: "Иванов Максим",
  clubId: "c1",
  clubName: "ACADEMY",
  status: "CONFIRMED",
  sex: "MALE",
  birthYear: 1998,
  declaredWeightKg: 76,
  weighedWeightKg: null,
  weighedAt: null,
  divisionId: "d76",
  divisionName: "до 76 кг",
  levelName: "Белый",
  levelPickedByCoach: false,
  fits: true,
  withdrawnReason: null,
  place: null,
  updatedAt: "2026-11-27T08:00:00.000Z",
  ...over,
})

const division = (id: string, name: string) => ({ id, name }) as TournamentDivision
const DIVISIONS = [division("d76", "до 76 кг"), division("d82", "до 82 кг")]

const renderSheet = (e: TournamentEntry, status: TournamentStatus = "WEIGH_IN") => {
  const onChanged = jest.fn()
  render(
    <>
      <WeighInSheet
        organizationId="o1"
        tournamentId="t1"
        status={status}
        entry={e}
        divisions={DIVISIONS}
        onClose={jest.fn()}
        onChanged={onChanged}
      />
      <ConfirmDialogHost />
    </>,
  )
  return { onChanged }
}

beforeEach(() => jest.clearAllMocks())

describe("WeighInSheet", () => {
  it("prefills the declared weight; off-weight offers the neighbouring division as the one filled button", async () => {
    weighMock.mockResolvedValue({
      entry: entry({ weighedWeightKg: 77.4, fits: false }),
      fits: false,
      suggestedDivisionId: "d82",
      suggestedDivisionName: "до 82 кг",
    })
    moveMock.mockResolvedValue(entry({ weighedWeightKg: 77.4, divisionId: "d82", divisionName: "до 82 кг", fits: true }))
    const { onChanged } = renderSheet(entry())
    const input = screen.getByLabelText("Вес на весах, кг") as HTMLInputElement
    expect(input.value).toBe("76,0")
    fireEvent.change(input, { target: { value: "77,4" } })
    fireEvent.click(screen.getByRole("button", { name: "Записать вес" }))
    expect(await screen.findByText("Не в весе для «до 76 кг»")).toBeTruthy()
    expect(weighMock.mock.calls[0][0]).toEqual({ organizationId: "o1", tournamentId: "t1", entryId: "e1", weighedKg: 77.4 })
    const filled = screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary"))
    expect(filled.map((b) => b.textContent)).toEqual(["Перевести в «до 82 кг»"])
    fireEvent.click(screen.getByRole("button", { name: "Перевести в «до 82 кг»" }))
    await waitFor(() => expect(moveMock).toHaveBeenCalledWith({ organizationId: "o1", tournamentId: "t1", entryId: "e1", divisionId: "d82" }))
    expect(onChanged).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("button", { name: /Перевести в/ })).toBeNull()
  })

  it("says the weight fits and offers no move", async () => {
    weighMock.mockResolvedValue({
      entry: entry({ weighedWeightKg: 75.8 }),
      fits: true,
      suggestedDivisionId: null,
      suggestedDivisionName: null,
    })
    renderSheet(entry())
    fireEvent.change(screen.getByLabelText("Вес на весах, кг"), { target: { value: "75.8" } })
    fireEvent.click(screen.getByRole("button", { name: "Записать вес" }))
    expect(await screen.findByText("Подходит: до 76 кг")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Перевести в/ })).toBeNull()
  })

  it("refuses a weight outside the contract range or with two decimals", () => {
    renderSheet(entry())
    const input = screen.getByLabelText("Вес на весах, кг")
    for (const bad of ["5", "77,45", "300"]) {
      fireEvent.change(input, { target: { value: bad } })
      expect(screen.getByText("Вес от 10 до 250 кг, с точностью до 0,1")).toBeTruthy()
      expect((screen.getByRole("button", { name: "Записать вес" }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it("in SETUP shows the division select only", () => {
    renderSheet(entry(), "SETUP")
    expect(screen.queryByLabelText("Вес на весах, кг")).toBeNull()
    expect(screen.getByText("Категория")).toBeTruthy()
  })

  it("withdraws after a confirm", async () => {
    withdrawMock.mockResolvedValue(entry({ status: "WITHDRAWN" }))
    renderSheet(entry())
    expect(screen.getByText("ACADEMY · мужской пол, 1998 г. р. · Белый · заявленный вес 76,0 кг")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Снять с турнира" }))
    const dialog = await screen.findByRole("dialog", { name: "Снять участника с турнира?" })
    expect(within(dialog).getByText(/^Иванов Максим не попадёт в сетку\. .* пока в категории нет результатов\.$/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Снять с турнира" }))
    await waitFor(() =>
      expect(withdrawMock).toHaveBeenCalledWith({ organizationId: "o1", tournamentId: "t1", entryId: "e1", withdrawn: true }),
    )
    expect(await screen.findByText("Заявка снята.")).toBeTruthy()
    expect(await screen.findByRole("button", { name: "Вернуть в турнир" })).toBeTruthy()
  })

  it("never puts «Участник скрыт» inside the confirm sentence", async () => {
    renderSheet(entry({ hidden: true, personName: null, clubName: null }))
    fireEvent.click(screen.getByRole("button", { name: "Снять с турнира" }))
    const dialog = await screen.findByRole("dialog", { name: "Снять участника с турнира?" })
    expect(within(dialog).getByText(/^Участник не попадёт в сетку\./)).toBeTruthy()
    expect(within(dialog).queryByText(/Участник скрыт/)).toBeNull()
  })
})
