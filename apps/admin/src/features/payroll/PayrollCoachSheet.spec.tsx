/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/payroll", () => ({
  addPayrollAdjustment: jest.fn(),
  deletePayrollAdjustment: jest.fn(),
  listCoachRates: jest.fn(),
  listPayrollClasses: jest.fn(),
  setCoachRate: jest.fn(),
}))

import {
  addPayrollAdjustment,
  deletePayrollAdjustment,
  listCoachRates,
  listPayrollClasses,
  setCoachRate,
  type PayrollLine,
  type PayrollMonth,
} from "../../shared/api/payroll"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PayrollCoachSheet } from "./PayrollCoachSheet"

const ratesMock = listCoachRates as jest.Mock
const setRateMock = setCoachRate as jest.Mock
const addMock = addPayrollAdjustment as jest.Mock
const deleteMock = deletePayrollAdjustment as jest.Mock
const classesMock = listPayrollClasses as jest.Mock

const COACH = "11111111-2222-4333-8444-555555555555"
const VERSION = "2026-11-20T10:00:00.000Z"

const RATE = {
  effectiveFrom: "2026-10",
  fixedMonthly: 0,
  perClass: 1500,
  perClassMinStudents: 3,
  perStudent: 100,
  revenueBp: 0,
  currency: "RUB",
}

const line = (over: Partial<PayrollLine> = {}): PayrollLine => ({
  coachId: COACH,
  name: "Ольга Кузнецова",
  rate: RATE,
  classes: 16,
  classesPaid: 14,
  marks: 100,
  marksPaid: 96,
  revenueBase: 0,
  amounts: { fixed: 0, classes: 21000, students: 9600, revenue: 0, adjustments: 5000 },
  total: 35600,
  adjustments: [
    {
      id: "a1",
      amount: 5000,
      currency: "RUB",
      ignored: false,
      comment: "Открытый урок",
      createdAt: "2026-11-30T09:00:00.000Z",
      createdByName: "Ольга Кузнецова",
    },
  ],
  ignoredRate: null,
  ...over,
})

const month = (over: Partial<PayrollMonth> = {}): PayrollMonth => ({
  month: "2026-11",
  status: "open",
  canClose: true,
  closedAt: null,
  closedBy: null,
  currency: "RUB",
  total: 35600,
  drift: null,
  driftByCoach: [],
  unattributed: { classes: 0, revenue: 0, otherCurrency: 0 },
  lines: [line()],
  ...over,
})

const renderSheet = (m: PayrollMonth) => {
  const handlers = { onClose: jest.fn(), onChanged: jest.fn() }
  render(
    <>
      <PayrollCoachSheet
        workspaceId="w1"
        month={m}
        line={m.lines[0]}
        currentMonth="2026-12"
        timezone="Europe/Moscow"
        coachPayVisible={false}
        startWithRate={false}
        {...handlers}
      />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

beforeEach(() => {
  jest.resetAllMocks()
  ratesMock.mockResolvedValue({
    currency: "RUB",
    coaches: [
      {
        coachId: COACH,
        name: "Ольга Кузнецова",
        role: "coach",
        updatedAt: VERSION,
        rates: [{ ...RATE, id: "r1", coachId: COACH, updatedAt: VERSION }],
      },
    ],
  })
})

describe("PayrollCoachSheet", () => {
  it("explains the month: paid classes, the unpaid ones and why, the marks", () => {
    renderSheet(month())
    expect(screen.getByText(/За тренировки: 14 × 1\s500 ₽ = 21\s000 ₽ \(ещё 2 не оплачены: пришло меньше 3\)/)).toBeTruthy()
    expect(screen.getByText(/За отметки: 96 × 100 ₽ = 9\s600 ₽/)).toBeTruthy()
  })

  it("sends the coach's rate version read when the panel opened", async () => {
    setRateMock.mockResolvedValue({})
    const { onChanged } = renderSheet(month())
    const edit = await screen.findByRole("button", { name: "Изменить ставку" })
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(edit)
    fireEvent.change(screen.getByLabelText(/^За тренировку/), { target: { value: "2000" } })
    fireEvent.change(screen.getByLabelText("Действует с"), { target: { value: "2026-12" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ставку" }))
    await waitFor(() => expect(setRateMock).toHaveBeenCalled())
    expect(setRateMock.mock.calls[0][0]).toEqual({
      workspaceId: "w1",
      coachId: COACH,
      data: {
        effectiveFrom: "2026-12",
        fixedMonthly: 0,
        perClass: 2000,
        perClassMinStudents: 3,
        perStudent: 100,
        revenueBp: 0,
        expectedUpdatedAt: VERSION,
      },
    })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it("starts a rate from the club's current month; the viewed past month stays selectable", async () => {
    setRateMock.mockResolvedValue({})
    renderSheet(month())
    const edit = await screen.findByRole("button", { name: "Изменить ставку" })
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(edit)
    const from = screen.getByLabelText("Действует с") as HTMLSelectElement
    expect(from.value).toBe("2026-12")
    expect([...from.options].map((o) => o.value)).toContain("2026-11")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ставку" }))
    await waitFor(() => expect(setRateMock).toHaveBeenCalled())
    expect(setRateMock.mock.calls[0][0].data.effectiveFrom).toBe("2026-12")
  })

  it("adds a deduction with its comment", async () => {
    addMock.mockResolvedValue({})
    const { onChanged } = renderSheet(month())
    fireEvent.click(screen.getByRole("button", { name: "Добавить корректировку" }))
    fireEvent.click(screen.getByRole("button", { name: "Удержание" }))
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "2 000" } })
    fireEvent.change(screen.getByLabelText(/Комментарий/), { target: { value: " Опоздания " } })
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(addMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      data: { month: "2026-11", coachId: COACH, amount: -2000, comment: "Опоздания" },
    })
  })

  it("refuses a zero adjustment before sending", () => {
    renderSheet(month())
    fireEvent.click(screen.getByRole("button", { name: "Добавить корректировку" }))
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText(/Комментарий/), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }))
    expect(screen.getByText(/Сумма — от 1 до/)).toBeTruthy()
    expect(addMock).not.toHaveBeenCalled()
  })

  it("deletes an adjustment only after the confirmation", async () => {
    deleteMock.mockResolvedValue({ status: "deleted" })
    const { onChanged } = renderSheet(month())
    fireEvent.click(screen.getByRole("button", { name: "Удалить корректировку «Открытый урок»" }))
    expect(await screen.findByText("Удалить корректировку?")).toBeTruthy()
    expect(deleteMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }))
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ workspaceId: "w1", adjustmentId: "a1" }))
    expect(onChanged).toHaveBeenCalled()
  })

  it("shows a closed month read-only: no forms, no delete, no rate history read", () => {
    renderSheet(
      month({ status: "closed", canClose: false, closedAt: "2026-12-02T10:00:00.000Z", closedBy: { id: "u1", name: "Ольга" } }),
    )
    expect(screen.queryByRole("button", { name: "Добавить корректировку" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Изменить ставку" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Удалить корректировку/ })).toBeNull()
    expect(screen.getByText(/Открытый урок/)).toBeTruthy()
    expect(ratesMock).not.toHaveBeenCalled()
  })

  it("lists the classes on first expand, with substitutions and cancellations", async () => {
    classesMock.mockResolvedValue({
      month: "2026-11",
      coachId: COACH,
      items: [
        {
          sessionId: "s1",
          date: "2026-11-03",
          startAt: "2026-11-03T15:00:00.000Z",
          groupId: "g1",
          groupName: "Взрослые",
          marks: 2,
          status: "unpaid",
          substitute: true,
          ranBy: null,
        },
        {
          sessionId: "s2",
          date: "2026-11-05",
          startAt: "2026-11-05T15:00:00.000Z",
          groupId: "g1",
          groupName: "Дети",
          marks: 8,
          status: "cancelled",
          substitute: false,
          ranBy: null,
        },
      ],
    })
    renderSheet(month())
    expect(classesMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Тренировки" }))
    expect(await screen.findByText(/замена · не оплачена/)).toBeTruthy()
    expect(screen.getByText(/отменена/)).toBeTruthy()
    expect(classesMock).toHaveBeenCalledWith({ workspaceId: "w1", coachId: COACH, month: "2026-11" })
  })
})
