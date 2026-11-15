/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/discounts", () => ({
  listDiscounts: jest.fn(),
  createDiscount: jest.fn(),
  updateDiscount: jest.fn(),
  deleteDiscount: jest.fn(),
}))
jest.mock("../../shared/api/subscriptions", () => ({
  listPlans: jest.fn().mockResolvedValue({ data: [] }),
}))
jest.mock("../../shared/api/workspaces", () => ({
  getWorkspaceSettings: jest.fn().mockResolvedValue({ timezone: "Europe/Moscow" }),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))

import { listDiscounts, type Discount, type DiscountList as Page } from "../../shared/api/discounts"
import { DiscountList } from "./DiscountList"

const listMock = listDiscounts as jest.Mock

const STAFF = "11111111-2222-4333-8444-555555555555"

const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Студенческая",
  kind: "PERCENT",
  value: 15,
  currency: null,
  code: null,
  isFamily: false,
  allPlans: true,
  plans: [],
  events: false,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  oncePerMember: false,
  isActive: true,
  status: "active",
  uses: 2,
  given: [{ currency: "RUB", amount: 1200 }],
  createdAt: "2026-11-14T10:00:00.000Z",
  updatedAt: "2026-11-14T10:00:00.000Z",
  ...over,
})

const page = (over: Partial<Page> = {}): Page => ({ data: [], byStaff: [], ...over })

beforeEach(() => {
  listMock.mockReset()
  window.history.replaceState(null, "", "/workspace/w1/subscriptions/discounts")
})

describe("DiscountList", () => {
  it("lists discounts with their size, way, scope and usage; a row opens the panel", async () => {
    listMock.mockResolvedValue(
      page({
        data: [
          discount(),
          discount({
            id: "d2",
            name: "Весна",
            kind: "FIXED",
            value: 500,
            currency: "RUB",
            code: "ВЕСНА",
            status: "expired",
            uses: 0,
            given: [],
          }),
        ],
      }),
    )
    render(<DiscountList workspaceId="w1" />)
    expect(await screen.findByText("Студенческая")).toBeTruthy()
    expect(screen.getByText("Выбирает сотрудник")).toBeTruthy()
    expect(screen.getByText("Промокод ВЕСНА")).toBeTruthy()
    expect(screen.getByText("Закончилась")).toBeTruthy()
    expect(screen.getAllByText("Все тарифы")).toHaveLength(2)
    // No staff reductions yet: no «Кто давал скидки».
    expect(screen.queryByText("Кто давал скидки")).toBeNull()

    fireEvent.click(screen.getByRole("row", { name: "Скидка «Студенческая»" }))
    expect(await screen.findByRole("heading", { name: "Студенческая" })).toBeTruthy()
    expect(window.location.search).toBe("?discount=d1")
  })

  it("says how to start, only after the list is in", async () => {
    const { promise, resolve } = Promise.withResolvers<Page>()
    listMock.mockReturnValue(promise)
    render(<DiscountList workspaceId="w1" />)
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    expect(screen.queryByText(/Скидок пока нет/)).toBeNull()
    resolve(page())
    expect(
      await screen.findByText("Скидок пока нет — создайте первую, например семейную"),
    ).toBeTruthy()
  })

  it("lists who gave discounts, each linked to their payments in the journal", async () => {
    listMock.mockResolvedValue(
      page({
        byStaff: [
          {
            userId: STAFF,
            name: "Петров",
            currency: "RUB",
            oneOff: { count: 5, amount: 3400 },
            named: { count: 0, amount: 0 },
          },
        ],
      }),
    )
    render(<DiscountList workspaceId="w1" />)
    expect(await screen.findByText("Кто давал скидки")).toBeTruthy()
    const link = screen.getByRole("link", { name: /Петров — разовые 3\s400 ₽ \(5 оплат\)/ })
    expect(link.getAttribute("href")).toBe(
      `/workspace/w1/subscriptions/payments?discounted=1&pricedById=${STAFF}`,
    )
  })

  it("asks for the archive and the period from the link", async () => {
    window.history.replaceState(
      null,
      "",
      "/workspace/w1/subscriptions/discounts?archived=1&from=2026-11-01&to=2026-11-15",
    )
    listMock.mockResolvedValue(
      page({
        byStaff: [
          {
            userId: STAFF,
            name: "Петров",
            currency: "RUB",
            oneOff: { count: 0, amount: 0 },
            named: { count: 2, amount: 800 },
          },
        ],
      }),
    )
    render(<DiscountList workspaceId="w1" />)
    await screen.findByText("Кто давал скидки")
    expect(listMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      archived: true,
      from: "2026-11-01",
      to: "2026-11-15",
    })
    expect(screen.getByRole("link", { name: /Петров/ }).getAttribute("href")).toBe(
      `/workspace/w1/subscriptions/payments?from=2026-11-01&to=2026-11-15&discounted=1&pricedById=${STAFF}`,
    )
    expect(screen.getByRole("button", { name: "Скрыть архив" })).toBeTruthy()
  })
})
