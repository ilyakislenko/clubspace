/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../../../shared/api/subscriptions", () => ({
  listRenewalCandidates: jest.fn(),
  listAwaitingPayment: jest.fn(),
}))
jest.mock("../../../../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))
jest.mock("../analytics/analytics-toolbar", () => ({
  AnalyticsFilters: () => null,
}))

import {
  listAwaitingPayment,
  listRenewalCandidates,
  type AwaitingPaymentResult,
  type RenewalCandidate,
} from "../../../../../shared/api/subscriptions"
import { RenewList } from "./renew-list"

const renewalsMock = listRenewalCandidates as jest.Mock
const awaitingMock = listAwaitingPayment as jest.Mock

const USER = "11111111-2222-4333-8444-555555555555"
const OTHER = "22222222-2222-4333-8444-555555555555"

const candidate = (over: Partial<RenewalCandidate> = {}): RenewalCandidate => ({
  userId: USER,
  firstname: "Иван",
  lastname: "Петров",
  email: null,
  phone: null,
  guardians: [],
  reason: "access_expiring",
  classesRemaining: null,
  classesTotal: null,
  accessUntil: null,
  planId: null,
  planName: "БЖЖ 12",
  endDate: "2099-12-15T00:00:00.000Z",
  directions: [],
  autopay: null,
  ...over,
})

const awaiting = (attention: AwaitingPaymentResult["autopayAttention"]): AwaitingPaymentResult => ({
  data: [],
  total: 0,
  members: 0,
  curPage: 1,
  perPage: 20,
  autopayAttention: attention,
})

const renderList = async () => {
  render(<RenewList workspaceId="w1" />)
  await waitFor(() => expect(awaitingMock).toHaveBeenCalled())
  await screen.findByText(/пора продлить/)
}

beforeEach(() => {
  renewalsMock.mockReset()
  awaitingMock.mockReset()
  renewalsMock.mockResolvedValue({ data: [], total: 0, curPage: 1, perPage: 50 })
})

describe("RenewList — «Автоплатёж не прошёл»", () => {
  it("is absent when no autopay failed", async () => {
    awaitingMock.mockResolvedValue(awaiting({ total: 0, data: [] }))
    await renderList()
    expect(screen.queryByText(/Автоплатёж не прошёл/)).toBeNull()
  })

  it("lists the failures with the reason and what comes next, each opening the member card", async () => {
    awaitingMock.mockResolvedValue(
      awaiting({
        total: 2,
        data: [
          {
            autopayId: "a1",
            member: { userId: USER, name: "Иван Петров" },
            planName: "БЖЖ 12",
            reason: null,
            lastError: "недостаточно средств",
            nextAttemptOn: "2026-12-16",
            since: "2026-12-14T07:00:00.000Z",
          },
          {
            autopayId: "a2",
            member: { userId: OTHER, name: "Анна Смирнова" },
            planName: "Йога 8",
            reason: "CARD_EXPIRED",
            lastError: null,
            nextAttemptOn: null,
            since: "2026-12-10T07:00:00.000Z",
          },
        ],
      }),
    )
    await renderList()
    expect(screen.getByRole("heading", { name: "Автоплатёж не прошёл · 2 ученика" })).toBeTruthy()
    const first = screen.getByRole("link", { name: /Иван Петров/ })
    expect(first.getAttribute("href")).toBe(`/workspace/w1/users/${USER}`)
    expect(first.textContent).toContain("БЖЖ 12 · недостаточно средств · повтор 16 дек.")
    expect(screen.getByRole("link", { name: /Анна Смирнова/ }).textContent).toContain(
      "Йога 8 · срок действия карты истёк · ждёт ученика",
    )
    // No buttons in the block: the member card is where staff act.
    expect(screen.queryByRole("button", { name: /Отключить|Списать/ })).toBeNull()
  })

  it("marks a renewal covered by autopay", async () => {
    awaitingMock.mockResolvedValue(awaiting({ total: 0, data: [] }))
    renewalsMock.mockResolvedValue({
      data: [candidate({ autopay: { status: "ACTIVE", nextChargeOn: "2099-12-14" } })],
      total: 1,
      curPage: 1,
      perPage: 50,
    })
    await renderList()
    expect(screen.getByText("продлится автоплатежом 14 дек.")).toBeTruthy()
  })
})
