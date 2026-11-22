/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/discounts", () => ({
  createDiscount: jest.fn(),
  updateDiscount: jest.fn(),
  deleteDiscount: jest.fn(),
}))

import { createDiscount, updateDiscount, type Discount } from "../../shared/api/discounts"
import type { Plan } from "../../shared/api/subscriptions"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { DiscountFormSheet } from "./DiscountFormSheet"

const createMock = createDiscount as jest.Mock
const updateMock = updateDiscount as jest.Mock

const PLAN = "11111111-2222-4333-8444-555555555555"

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: PLAN,
  workspaceId: "w1",
  name: "Безлимит",
  description: null,
  price: 5000,
  currency: "RUB",
  durationDays: 30,
  classCount: null,
  isFreeTrial: false,
  startsOnFirstVisit: false,
  isActive: true,
  purchasableOnline: false,
  directions: [],
  updatedAt: "2026-11-14T10:00:00.000Z",
  ...over,
})

const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Семейная",
  kind: "PERCENT",
  value: 10,
  currency: null,
  code: null,
  isFamily: true,
  allPlans: true,
  plans: [],
  events: false,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  oncePerMember: false,
  isActive: true,
  status: "active",
  uses: 0,
  given: [],
  createdAt: "2026-11-14T10:00:00.000Z",
  updatedAt: "2026-11-14T10:00:00.000Z",
  ...over,
})

const renderSheet = (props: { discount?: Discount | null; activeFamily?: Discount | null }) => {
  const handlers = { onClose: jest.fn(), onSaved: jest.fn(), onReload: jest.fn() }
  render(
    <>
      <DiscountFormSheet
        workspaceId="w1"
        open
        discount={props.discount ?? null}
        plans={[plan()]}
        activeFamily={props.activeFamily ?? null}
        {...handlers}
      />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
})

describe("DiscountFormSheet", () => {
  it("closes the family option, with the reason, while another one is active", () => {
    renderSheet({ activeFamily: discount() })
    const family = screen.getByRole("radio", { name: "Семейная — применяется сама" })
    expect((family as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("В клубе уже есть семейная скидка «Семейная»")).toBeTruthy()
  })

  it("keeps the family option open on the family discount itself, without limits", () => {
    renderSheet({ discount: discount(), activeFamily: discount() })
    const family = screen.getByRole("radio", { name: "Семейная — применяется сама" })
    expect((family as HTMLInputElement).disabled).toBe(false)
    expect((family as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByText("Ограничения")).toBeNull()
    expect(screen.queryByLabelText("Не больше раз всего")).toBeNull()
    expect(screen.getByText("Изменения не затронут уже проданные абонементы")).toBeTruthy()
  })

  it("creates a promo code discount for chosen tariffs with its limits", async () => {
    createMock.mockResolvedValue(discount())
    const { onSaved, onClose } = renderSheet({})
    expect(screen.getByText("Ограничения")).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText("Например, «Студенческая»"), {
      target: { value: " Весна " },
    })
    fireEvent.change(screen.getByLabelText("Размер"), { target: { value: "500" } })
    fireEvent.click(screen.getByRole("button", { name: "₽" }))
    fireEvent.click(screen.getByRole("radio", { name: "По промокоду" }))
    fireEvent.change(screen.getByLabelText("Промокод"), { target: { value: "весна" } })
    fireEvent.click(screen.getByRole("radio", { name: "Выбрать тарифы…" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Безлимит" }))
    fireEvent.change(screen.getByLabelText("Окончание"), { target: { value: "2027-03-31" } })
    fireEvent.change(screen.getByLabelText("Не больше раз всего"), { target: { value: "50" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Один раз на ученика" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      data: {
        name: "Весна",
        kind: "FIXED",
        value: 500,
        currency: "RUB",
        code: "ВЕСНА",
        isFamily: false,
        allPlans: false,
        planIds: [PLAN],
        events: false,
        startsOn: null,
        endsOn: "2027-03-31",
        maxUses: 50,
        oncePerMember: true,
      },
    })
  })

  it("refuses a percent over 100, a bad code and an empty scope before sending", () => {
    renderSheet({})
    fireEvent.change(screen.getByPlaceholderText("Например, «Студенческая»"), {
      target: { value: "Ошибка" },
    })
    fireEvent.change(screen.getByLabelText("Размер"), { target: { value: "150" } })
    fireEvent.click(screen.getByRole("radio", { name: "По промокоду" }))
    fireEvent.change(screen.getByLabelText("Промокод"), { target: { value: "а б" } })
    fireEvent.click(screen.getByRole("radio", { name: "Выбрать тарифы…" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(screen.getByText("Процент — от 1 до 100")).toBeTruthy()
    expect(screen.getByText("Промокод — от 3 до 32 букв, цифр или дефисов")).toBeTruthy()
    expect(screen.getByText("Выберите, на что действует скидка")).toBeTruthy()
    expect(createMock).not.toHaveBeenCalled()
  })

  it("sends the version it opened with", async () => {
    updateMock.mockResolvedValue(discount())
    const staff = discount({ isFamily: false, name: "Студенческая", uses: 3 })
    renderSheet({ discount: staff })
    fireEvent.change(screen.getByLabelText("Размер"), { target: { value: "15" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      value: 15,
      expectedUpdatedAt: staff.updatedAt,
    })
  })
})
