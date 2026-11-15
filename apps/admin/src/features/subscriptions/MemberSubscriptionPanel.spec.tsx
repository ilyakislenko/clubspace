/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/subscriptions", () => ({
  listPlans: jest.fn(),
  listMemberSubscriptions: jest.fn(),
  assignSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  markSubscriptionPaid: jest.fn(),
  unmarkSubscriptionPaid: jest.fn(),
}))
jest.mock("../../shared/api/discounts", () => ({
  listSaleDiscounts: jest.fn(),
}))
jest.mock("../../shared/lib/use-my-membership", () => ({
  useMyMembership: jest.fn(() => null),
}))
jest.mock("../../shared/api/autopay", () => ({
  listMemberAutopays: jest.fn(),
  cancelMemberAutopay: jest.fn(),
}))

import { listMemberAutopays } from "../../shared/api/autopay"
import { useMyMembership } from "../../shared/lib/use-my-membership"

import { listSaleDiscounts, type SaleDiscountOption } from "../../shared/api/discounts"
import {
  assignSubscription,
  listMemberSubscriptions,
  listPlans,
  markSubscriptionPaid,
  type MemberSubscriptions,
  type Plan,
} from "../../shared/api/subscriptions"
import { MemberSubscriptionPanel } from "./MemberSubscriptionPanel"

const PLAN = "11111111-2222-4333-8444-555555555555"

const plan: Plan = {
  id: PLAN,
  workspaceId: "w1",
  name: "Безлимит",
  description: null,
  price: 4000,
  currency: "RUB",
  durationDays: 30,
  classCount: null,
  isFreeTrial: false,
  startsOnFirstVisit: false,
  isActive: true,
  purchasableOnline: false,
  autopayAvailable: false,
  directions: [],
  updatedAt: "2026-11-14T10:00:00.000Z",
}

const family: SaleDiscountOption = {
  discountId: "fam",
  name: "Семейная",
  kind: "PERCENT",
  value: 10,
  code: null,
  isFamily: true,
  endsOn: null,
  items: [{ planId: PLAN, eventId: null, listPrice: 4000, amount: 3600, currency: "RUB" }],
}

type Row = MemberSubscriptions["history"][number]

const unpaid = (over: Partial<Row> = {}): Row => ({
  id: "s1",
  planId: PLAN,
  planName: "Безлимит",
  status: "CANCELLED",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-10-01T00:00:00.000Z",
  durationDays: 30,
  startsOnFirstVisit: false,
  amountPaid: 4000,
  currency: "RUB",
  refundedAmount: 0,
  listPrice: 4000,
  discountId: null,
  discountName: null,
  discountAmount: 0,
  oneOffDiscount: 0,
  pricedBy: null,
  isPaid: false,
  paidAt: null,
  paymentMethod: null,
  classesTotal: null,
  classesRemaining: null,
  source: "MANUAL",
  paidByAutopay: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  directions: [],
  ...over,
})

const subs = (history: Row[] = []): MemberSubscriptions => ({
  memberName: "Миша",
  abonements: [],
  history,
  freezes: [],
  permissions: { canManage: true, canCancel: true, canUnmarkPayment: true },
})

const renderPanel = () =>
  render(
    <MemberSubscriptionPanel workspaceId="w1" userId="u1" isAdmin canCreatePlans />,
  )

const pickPlan = async () => {
  const select = await screen.findByDisplayValue("Выберите тариф…")
  fireEvent.change(select, { target: { value: PLAN } })
}

const plain = (s: string | null | undefined) => s?.replace(/\s/g, " ") ?? null

beforeEach(() => {
  jest.clearAllMocks()
  ;(listPlans as jest.Mock).mockResolvedValue({ data: [plan] })
  ;(listMemberSubscriptions as jest.Mock).mockResolvedValue(subs())
})

describe("MemberSubscriptionPanel sale", () => {
  it("shows no «Скидка» when no discount applies to the tariff", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: false, options: [] })
    renderPanel()
    await pickPlan()
    expect(screen.queryByLabelText("Скидка")).toBeNull()
    expect((screen.getByLabelText("Сумма") as HTMLInputElement).value).toBe("4000")
  })

  it("preselects the family discount, notes a lower typed amount and sends both", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(assignSubscription as jest.Mock).mockResolvedValue({})
    renderPanel()
    await pickPlan()
    const discount = screen.getByLabelText("Скидка") as HTMLSelectElement
    expect(discount.value).toBe("fam")
    expect(screen.getByText("У члена семьи есть действующий абонемент")).toBeTruthy()
    const amount = screen.getByLabelText("Сумма") as HTMLInputElement
    expect(amount.value).toBe("3600")
    expect(screen.queryByText(/Разовая скидка/)).toBeNull()

    fireEvent.change(amount, { target: { value: "3000" } })
    expect(plain(screen.getByText(/Разовая скидка/).textContent)).toBe(
      "Разовая скидка −600 ₽ к цене по тарифу — будет видна в «Платежах»",
    )

    fireEvent.click(screen.getByRole("button", { name: "Назначить" }))
    await waitFor(() => expect(assignSubscription).toHaveBeenCalled())
    expect((assignSubscription as jest.Mock).mock.calls[0][0].data).toMatchObject({
      planId: PLAN,
      amountPaid: 3000,
      discountId: "fam",
    })
  })

  it("«Без скидки» goes back to the tariff price and sends no discount", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(assignSubscription as jest.Mock).mockResolvedValue({})
    renderPanel()
    await pickPlan()
    fireEvent.change(screen.getByLabelText("Скидка"), { target: { value: "" } })
    expect((screen.getByLabelText("Сумма") as HTMLInputElement).value).toBe("4000")
    fireEvent.click(screen.getByRole("button", { name: "Назначить" }))
    await waitFor(() => expect(assignSubscription).toHaveBeenCalled())
    expect((assignSubscription as jest.Mock).mock.calls[0][0].data.discountId).toBeUndefined()
  })
})

describe("MemberSubscriptionPanel mark-paid", () => {
  it("offers a discount for a sale without one and reprices the amount", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(listMemberSubscriptions as jest.Mock).mockResolvedValue(subs([unpaid({ status: "ACTIVE" })]))
    ;(markSubscriptionPaid as jest.Mock).mockResolvedValue({})
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Отметить оплату" }))
    const discount = screen.getByLabelText("Скидка") as HTMLSelectElement
    // The seller agreed on no discount: nothing is preselected here.
    expect(discount.value).toBe("")
    fireEvent.change(discount, { target: { value: "fam" } })
    expect((screen.getByLabelText("Получено") as HTMLInputElement).value).toBe("3600")
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить оплату" }))
    await waitFor(() => expect(markSubscriptionPaid).toHaveBeenCalled())
    expect((markSubscriptionPaid as jest.Mock).mock.calls[0][0].data).toMatchObject({
      amount: 3600,
      discountId: "fam",
    })
  })

  // The sale recorded 5 000 ₽; today's tariff price (4 000) prices the option.
  const recordedAtOldPrice = () =>
    subs([unpaid({ status: "ACTIVE", listPrice: 5000, amountPaid: 5000 })])

  it("lets the server price a discount it can't price here: no amount is sent", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(listMemberSubscriptions as jest.Mock).mockResolvedValue(recordedAtOldPrice())
    ;(markSubscriptionPaid as jest.Mock).mockResolvedValue({})
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Отметить оплату" }))
    fireEvent.change(screen.getByLabelText("Скидка"), { target: { value: "fam" } })
    expect((screen.getByLabelText("Получено") as HTMLInputElement).value).toBe("")
    expect(screen.getByText("Сумму со скидкой посчитаем от цены, записанной при продаже")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить оплату" }))
    await waitFor(() => expect(markSubscriptionPaid).toHaveBeenCalled())
    const data = (markSubscriptionPaid as jest.Mock).mock.calls[0][0].data
    expect(data.discountId).toBe("fam")
    expect(data).not.toHaveProperty("amount")
  })

  it("sends a typed amount with that discount", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(listMemberSubscriptions as jest.Mock).mockResolvedValue(recordedAtOldPrice())
    ;(markSubscriptionPaid as jest.Mock).mockResolvedValue({})
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Отметить оплату" }))
    fireEvent.change(screen.getByLabelText("Скидка"), { target: { value: "fam" } })
    fireEvent.change(screen.getByLabelText("Получено"), { target: { value: "4200" } })
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить оплату" }))
    await waitFor(() => expect(markSubscriptionPaid).toHaveBeenCalled())
    expect((markSubscriptionPaid as jest.Mock).mock.calls[0][0].data).toMatchObject({
      amount: 4200,
      discountId: "fam",
    })
  })

  it("shows no discount for a sale that already has one or no recorded price", async () => {
    ;(listSaleDiscounts as jest.Mock).mockResolvedValue({ familyEligible: true, options: [family] })
    ;(listMemberSubscriptions as jest.Mock).mockResolvedValue(
      subs([unpaid({ status: "ACTIVE", listPrice: null })]),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Отметить оплату" }))
    expect(screen.queryByLabelText("Скидка")).toBeNull()
    fireEvent.change(screen.getByLabelText("Получено"), { target: { value: "3000" } })
    // No list price: nothing to call a one-off reduction.
    expect(screen.queryByText(/Разовая скидка/)).toBeNull()
  })
})

describe("MemberSubscriptionPanel autopay", () => {
  const membership = useMyMembership as jest.Mock
  const autopays = listMemberAutopays as jest.Mock

  afterEach(() => membership.mockReturnValue(null))

  it("shows a sport lead the member's autopay", async () => {
    membership.mockReturnValue({ role: "head_coach", isOwner: false })
    autopays.mockResolvedValue({ data: [] })
    renderPanel()
    await waitFor(() => expect(autopays).toHaveBeenCalledWith({ workspaceId: "w1", userId: "u1" }))
  })

  it("never asks for it for a plain coach (the route is the sport leads')", async () => {
    membership.mockReturnValue({ role: "coach", isOwner: false })
    renderPanel()
    await screen.findByText("Нет действующего абонемента")
    expect(autopays).not.toHaveBeenCalled()
  })
})
