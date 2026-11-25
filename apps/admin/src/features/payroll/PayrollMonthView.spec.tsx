/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/payroll", () => ({
  getPayrollMonth: jest.fn(),
  closePayrollMonth: jest.fn(),
  listCoachRates: jest.fn().mockResolvedValue({ currency: "RUB", coaches: [] }),
}))
jest.mock("../../shared/api/workspaces", () => ({
  getWorkspaceSettings: jest.fn(),
}))
jest.mock("../../shared/api/exports", () => ({
  downloadExport: jest.fn(),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))

import { downloadExport } from "../../shared/api/exports"
import {
  closePayrollMonth,
  getPayrollMonth,
  listCoachRates,
  type PayrollLine,
  type PayrollMonth,
} from "../../shared/api/payroll"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PayrollMonthView } from "./PayrollMonthView"

const getMock = getPayrollMonth as jest.Mock
const closeMock = closePayrollMonth as jest.Mock
const settingsMock = getWorkspaceSettings as jest.Mock
const csvMock = downloadExport as jest.Mock
const ratesMock = listCoachRates as jest.Mock

const line = (over: Partial<PayrollLine>): PayrollLine => ({
  coachId: "c1",
  name: "Борис",
  rate: null,
  classes: 4,
  classesPaid: 4,
  marks: 20,
  marksPaid: 20,
  revenueBase: 0,
  amounts: { fixed: 0, classes: 0, students: 0, revenue: 0, adjustments: 0 },
  total: 0,
  adjustments: [],
  ignoredRate: null,
  ...over,
})

const month = (over: Partial<PayrollMonth> = {}): PayrollMonth => ({
  month: "2026-10",
  status: "open",
  canClose: true,
  closedAt: null,
  closedBy: null,
  currency: "RUB",
  total: 41000,
  drift: null,
  driftByCoach: [],
  unattributed: { classes: 0, revenue: 0, otherCurrency: 0 },
  lines: [
    line({
      coachId: "c2",
      name: "Анна",
      rate: {
        effectiveFrom: "2026-01",
        fixedMonthly: 30000,
        perClass: 0,
        perClassMinStudents: 1,
        perStudent: 0,
        revenueBp: 0,
        currency: "RUB",
      },
      amounts: { fixed: 30000, classes: 0, students: 0, revenue: 0, adjustments: 5000 },
      total: 35000,
    }),
    line({
      coachId: "c1",
      name: "Борис",
      classes: 5,
      classesPaid: 3,
      amounts: { fixed: 0, classes: 0, students: 0, revenue: 0, adjustments: 6000 },
      total: 6000,
    }),
  ],
  ...over,
})

const renderView = () =>
  render(
    <>
      <PayrollMonthView workspaceId="w1" />
      <ConfirmDialogHost />
    </>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, "", "/workspace/w1/analytics/payroll?month=2026-10")
  settingsMock.mockResolvedValue({ timezone: "Europe/Moscow", coachPayVisible: true })
  ratesMock.mockResolvedValue({ currency: "RUB", coaches: [] })
})

describe("PayrollMonthView", () => {
  it("lists coaches by name with paid/counted classes, the missing rate and the total", async () => {
    getMock.mockResolvedValue(month())
    renderView()
    const rows = await screen.findAllByRole("row")
    expect(getMock).toHaveBeenCalledWith({ workspaceId: "w1", month: "2026-10" })
    expect(screen.getByRole("heading", { name: "Октябрь 2026" })).toBeTruthy()
    expect(screen.getByText("Предварительно — пересчитывается")).toBeTruthy()
    // header, Анна, Борис, footer
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getByText("Анна")).toBeTruthy()
    expect(within(rows[2]).getByText("Ставка не задана")).toBeTruthy()
    expect(within(rows[2]).getByText("3 / 5")).toBeTruthy()
    expect(within(rows[3]).getByText(/41\s000 ₽/)).toBeTruthy()
  })

  it("closes with the shown total after a confirmation that names the switch", async () => {
    getMock.mockResolvedValue(month())
    closeMock.mockResolvedValue(
      month({ status: "closed", canClose: false, closedAt: "2026-11-02T10:00:00.000Z", closedBy: { id: "u", name: "Ольга" } }),
    )
    renderView()
    fireEvent.click(await screen.findByRole("button", { name: "Закрыть месяц" }))
    expect(await screen.findByText("Закрыть октябрь?")).toBeTruthy()
    expect(screen.getByText(/Тренеры увидят свои выплаты в приложении\./)).toBeTruthy()
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть месяц" }))
    await waitFor(() =>
      expect(closeMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        month: "2026-10",
        expectedTotal: 41000,
        expectedLines: [
          { coachId: "c2", total: 35000 },
          { coachId: "c1", total: 6000 },
        ],
      }),
    )
    expect(await screen.findByText(/Закрыт 2 нояб\. · Ольга/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Открыть заново" })).toBeTruthy()
  })

  it("reloads and shows the server's answer when the sums changed", async () => {
    getMock.mockResolvedValue(month())
    closeMock.mockRejectedValue({
      response: { status: 409, data: { code: "STALE_UPDATE", message: "Суммы изменились — проверьте и закройте снова" } },
    })
    renderView()
    fireEvent.click(await screen.findByRole("button", { name: "Закрыть месяц" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Закрыть месяц" }))
    expect(await screen.findByText("Суммы изменились — проверьте и закройте снова")).toBeTruthy()
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it("shows the drift of a closed month and downloads its CSV", async () => {
    getMock.mockResolvedValue(
      month({ status: "closed", canClose: false, closedAt: "2026-11-02T10:00:00.000Z", closedBy: null, drift: 1200 }),
    )
    renderView()
    expect(await screen.findByText(/сейчас вышло бы на 1\s200 ₽ больше/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Закрыть месяц" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Скачать CSV" }))
    await waitFor(() =>
      expect(csvMock).toHaveBeenCalledWith({ workspaceId: "w1", kind: "payroll", query: { month: "2026-10" } }),
    )
  })

  it("says so when the month has nothing and nobody can hold a rate", async () => {
    getMock.mockResolvedValue(month({ lines: [], total: 0 }))
    renderView()
    expect(await screen.findByText("В этом месяце тренировок не было и ставки не заданы")).toBeTruthy()
  })

  it("lists staff without a row in an open month; the row opens straight on the rate form", async () => {
    getMock.mockResolvedValue(month({ lines: [], total: 0 }))
    ratesMock.mockResolvedValue({
      currency: "RUB",
      coaches: [{ coachId: "adm", name: "Ольга Кузнецова", role: "admin", updatedAt: null, rates: [] }],
    })
    renderView()
    const row = await screen.findByRole("row", { name: "Ольга Кузнецова" })
    expect(within(row).getByText("Ставка не задана")).toBeTruthy()
    fireEvent.click(row)
    expect(await screen.findByRole("button", { name: "Сохранить ставку" })).toBeTruthy()
  })

  it("shows only the snapshot of a closed month, without staff rows", async () => {
    getMock.mockResolvedValue(month({ status: "closed", canClose: false, closedAt: "2026-11-02T10:00:00.000Z" }))
    ratesMock.mockResolvedValue({
      currency: "RUB",
      coaches: [{ coachId: "adm", name: "Ольга Кузнецова", role: "admin", updatedAt: null, rates: [] }],
    })
    renderView()
    expect(await screen.findByText("Анна")).toBeTruthy()
    expect(screen.queryByText("Ольга Кузнецова")).toBeNull()
  })
})
