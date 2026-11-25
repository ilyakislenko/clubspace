/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/payment-journal", () => ({
  getPaymentJournalEntry: jest.fn(),
  createRefund: jest.fn(),
  deleteRefund: jest.fn(),
}))

import {
  createRefund,
  deleteRefund,
  getPaymentJournalEntry,
  type PaymentJournalEntry,
  type PaymentJournalEntryDetail,
  type PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PaymentEntrySheet } from "./PaymentEntrySheet"

const getEntry = getPaymentJournalEntry as jest.Mock
const refund = createRefund as jest.Mock
const remove = deleteRefund as jest.Mock

const REFUND_ID = "7b0c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"

const row = (over: Partial<PaymentJournalEntry> = {}): PaymentJournalEntry => ({
  id: "sub:s1",
  kind: "payment",
  source: "abonement",
  at: "2026-11-03T15:40:00.000Z",
  amount: 4000,
  currency: "RUB",
  method: "CASH",
  member: { userId: "u1", name: "Иван Петров", isMember: true },
  itemName: "БЖЖ 12",
  subscriptionId: "s1",
  eventRegistrationId: null,
  eventId: null,
  markedBy: { userId: "c1", name: "Анна Ли" },
  payer: null,
  refundedAmount: 0,
  refundable: 4000,
  online: null,
  reason: null,
  refundOf: null,
  listPrice: null,
  discountName: null,
  discountAmount: 0,
  oneOffDiscount: 0,
  pricedBy: null,
  ...over,
})

const detail = (over: Partial<PaymentJournalEntryDetail> = {}): PaymentJournalEntryDetail => ({
  ...row(),
  refunds: [],
  memberHasCard: true,
  fullRefundCancelsRegistration: false,
  cardLabel: null,
  ...over,
})

const cashRefund = (over: Partial<PaymentJournalEntry> = {}): PaymentJournalEntry =>
  row({
    id: `ref:${REFUND_ID}`,
    kind: "refund",
    at: "2026-11-05T10:00:00.000Z",
    amount: 1000,
    refundable: 0,
    reason: "Переезд",
    refundOf: { id: "sub:s1", at: "2026-11-03T15:40:00.000Z", amount: 4000 },
    ...over,
  })

const ONLINE = {
  paymentId: "p1",
  provider: "YOOKASSA" as const,
  providerRef: "ab12cd",
  status: "SUCCEEDED" as const,
  refundable: 4000,
  autopay: false,
}

const renderSheet = (props: {
  entryId?: string | null
  unapplied?: PaymentJournalUnapplied | null
}) => {
  const handlers = { onClose: jest.fn(), onChanged: jest.fn() }
  render(
    <>
      <PaymentEntrySheet
        workspaceId="w1"
        timezone="Europe/Moscow"
        entryId={props.entryId ?? null}
        unapplied={props.unapplied ?? null}
        {...handlers}
      />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

const openRefundForm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Вернуть деньги" }))
  return screen.findByLabelText("Сумма")
}

beforeEach(() => {
  getEntry.mockReset()
  refund.mockReset()
  remove.mockReset()
})

describe("PaymentEntrySheet", () => {
  it("shows a cash payment's facts with the member's card", async () => {
    getEntry.mockResolvedValue(detail())
    renderSheet({ entryId: "sub:s1" })
    expect(await screen.findByText("Абонемент «БЖЖ 12»")).toBeTruthy()
    expect(getEntry).toHaveBeenCalledWith({ workspaceId: "w1", entryId: "sub:s1" })
    expect(screen.getByRole("link", { name: "Иван Петров" }).getAttribute("href")).toBe(
      "/workspace/w1/users/u1",
    )
    expect(screen.getByText("Наличные")).toBeTruthy()
    expect(screen.getByText("Анна Ли")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Вернуть деньги" })).toBeTruthy()
  })

  it("shows the list price, the discount and the one-off part with who set it", async () => {
    getEntry.mockResolvedValue(
      detail({
        amount: 2600,
        listPrice: 4000,
        discountName: "Семейная",
        discountAmount: 400,
        oneOffDiscount: 1000,
        pricedBy: { userId: "c2", name: "Пётр Петров" },
      }),
    )
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    const fact = (label: string) =>
      screen.getByText(label).nextElementSibling?.textContent?.replace(/\s/g, " ")
    expect(fact("Цена по тарифу")).toBe("4 000 ₽")
    expect(fact("Скидка")).toBe("«Семейная» −400 ₽")
    expect(fact("Разовая скидка")).toBe("1 000 ₽ · Пётр Петров")
    expect(fact("Получено")).toBe("2 600 ₽")
  })

  it("shows no price facts for a sale from before they were recorded", async () => {
    getEntry.mockResolvedValue(detail())
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    expect(screen.queryByText("Цена по тарифу")).toBeNull()
    expect(screen.queryByText("Получено")).toBeNull()
  })

  it("names a former member without a link", async () => {
    getEntry.mockResolvedValue(
      detail({ member: { userId: "u1", name: "Иван Петров", isMember: false }, memberHasCard: false }),
    )
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    expect(screen.queryByRole("link", { name: "Иван Петров" })).toBeNull()
    expect(screen.getByText("Иван Петров")).toBeTruthy()
  })

  it("names the guardian who paid online for a child, only when there is one", async () => {
    getEntry.mockResolvedValue(
      detail({
        method: "ONLINE",
        markedBy: null,
        online: ONLINE,
        member: { userId: "kid", name: "Миша Петров", isMember: true },
        payer: { userId: "mom", name: "Елена Петрова" },
      }),
    )
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    expect(screen.getByText("Оплатил(а)").nextElementSibling?.textContent).toBe(
      "Елена Петрова · родитель",
    )
  })

  it("shows no «Оплатил(а)» when the holder paid", async () => {
    getEntry.mockResolvedValue(detail({ method: "ONLINE", markedBy: null, online: ONLINE }))
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    expect(screen.queryByText("Оплатил(а)")).toBeNull()
  })

  it("offers no refund once all the money went back", async () => {
    getEntry.mockResolvedValue(detail({ refundedAmount: 4000, refundable: 0 }))
    renderSheet({ entryId: "sub:s1" })
    await screen.findByText("Абонемент «БЖЖ 12»")
    expect(screen.queryByRole("button", { name: "Вернуть деньги" })).toBeNull()
  })

  it("records a cash refund without asking, once, after a reason is given", async () => {
    getEntry.mockResolvedValue(detail())
    const after = detail({
      refundedAmount: 4000,
      refundable: 0,
      refunds: [cashRefund({ amount: 4000, reason: "Переезд" })],
    })
    const answer = Promise.withResolvers<unknown>()
    refund.mockReturnValue(answer.promise)
    const { onChanged } = renderSheet({ entryId: "sub:s1" })

    const amount = (await openRefundForm()) as HTMLInputElement
    expect(amount.value).toBe("4000")
    const methods = screen.getByRole("radiogroup", { name: "Как вернули" })
    expect(within(methods).getAllByRole("radio")).toHaveLength(3)
    expect((within(methods).getByLabelText("Наличные") as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText(/На карту/)).toBeNull()
    expect(
      screen.getByText("Абонемент останется действующим — отменить его можно в карточке ученика"),
    ).toBeTruthy()

    const submit = screen.getByRole("button", { name: /Вернуть 4.000 ₽/ })
    fireEvent.click(submit)
    expect(await screen.findByText("Укажите причину возврата")).toBeTruthy()
    expect(refund).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: " Переезд " } })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(refund).toHaveBeenCalledTimes(1))
    expect(refund).toHaveBeenCalledWith({
      workspaceId: "w1",
      data: { target: "abonement", targetId: "s1", amount: 4000, method: "CASH", reason: "Переезд" },
    })
    // An offline record asks nothing: it can be deleted.
    expect(screen.queryByRole("dialog", { name: /на карту/ })).toBeNull()

    answer.resolve({ refund: cashRefund({ amount: 4000 }), sale: after })
    expect(await screen.findByText(/Возврат 4.000 ₽ записан/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Вернуть деньги" })).toBeNull()
  })

  it("asks before an online refund and sends the money back through the provider", async () => {
    getEntry.mockResolvedValue(detail({ method: "ONLINE", markedBy: null, online: ONLINE }))
    refund.mockResolvedValue({
      refund: cashRefund({ method: "ONLINE", amount: 1000 }),
      sale: detail({ method: "ONLINE", online: { ...ONLINE, refundable: 3000 }, refundedAmount: 1000, refundable: 3000 }),
    })
    renderSheet({ entryId: "sub:s1" })
    expect(await screen.findByText(/ЮKassa · № …ab12cd · Оплачен/)).toBeTruthy()

    const amount = await openRefundForm()
    expect((screen.getByLabelText("На карту через ЮKassa") as HTMLInputElement).checked).toBe(true)
    fireEvent.change(amount, { target: { value: "1000" } })
    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "Болезнь" } })
    fireEvent.click(screen.getByRole("button", { name: /Вернуть 1.000 ₽/ }))

    const dialog = await screen.findByRole("dialog", { name: /Вернуть 1.000 ₽ на карту\?/ })
    expect(within(dialog).getByText(/Отменить возврат будет нельзя/)).toBeTruthy()
    expect(refund).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: /Вернуть 1.000 ₽/ }))
    await waitFor(() =>
      expect(refund).toHaveBeenCalledWith({
        workspaceId: "w1",
        data: { target: "abonement", targetId: "s1", amount: 1000, method: "ONLINE", reason: "Болезнь" },
      }),
    )
    expect(await screen.findByText(/Деньги возвращены на карту: 1.000 ₽/)).toBeTruthy()
  })

  it("warns that a full refund of an upcoming ticket frees the place", async () => {
    getEntry.mockResolvedValue(
      detail({
        id: "reg:r1",
        source: "ticket",
        itemName: "Семинар",
        subscriptionId: null,
        eventRegistrationId: "r1",
        eventId: "e1",
        fullRefundCancelsRegistration: true,
      }),
    )
    renderSheet({ entryId: "reg:r1" })
    const amount = await openRefundForm()
    const hint = "Запись на событие будет отменена, место перейдёт следующему в листе ожидания"
    expect(screen.getByText(hint)).toBeTruthy()
    fireEvent.change(amount, { target: { value: "1000" } })
    expect(screen.queryByText(hint)).toBeNull()

    refund.mockResolvedValue({
      refund: cashRefund({ id: "ref:r9", amount: 4000 }),
      sale: detail({ refundedAmount: 4000, refundable: 0, fullRefundCancelsRegistration: false }),
    })
    fireEvent.change(amount, { target: { value: "4000" } })
    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "Отменила участие" } })
    fireEvent.click(screen.getByRole("button", { name: /Вернуть 4.000 ₽/ }))
    expect(await screen.findByText(/Возврат 4.000 ₽ записан. Запись на событие отменена/)).toBeTruthy()
  })

  it("reloads the payment when someone refunded it meanwhile", async () => {
    getEntry.mockResolvedValue(detail())
    refund.mockRejectedValue({
      response: { status: 409, data: { code: "CONFLICT", message: "Возврат по этой оплате уже записан" } },
    })
    renderSheet({ entryId: "sub:s1" })
    await openRefundForm()
    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "Переезд" } })
    fireEvent.click(screen.getByRole("button", { name: /Вернуть 4.000 ₽/ }))
    expect(await screen.findByText("Данные изменились — проверьте сумму")).toBeTruthy()
    await waitFor(() => expect(getEntry).toHaveBeenCalledTimes(2))
  })

  it("deletes an offline refund's record after confirming; an online one has no action", async () => {
    getEntry.mockResolvedValue(
      detail({
        refundedAmount: 3000,
        refundable: 1000,
        refunds: [
          cashRefund(),
          cashRefund({ id: "ref:11111111-2222-4333-8444-555555555555", method: "ONLINE", amount: 2000 }),
        ],
      }),
    )
    remove.mockResolvedValue({ status: "deleted" })
    const { onChanged } = renderSheet({ entryId: "sub:s1" })
    const actions = await screen.findAllByRole("button", { name: /Действия с возвратом/ })
    expect(actions).toHaveLength(1)
    fireEvent.keyDown(actions[0], { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Удалить запись о возврате" }))

    const dialog = await screen.findByRole("dialog", { name: /Удалить запись о возврате 1.000 ₽\?/ })
    expect(within(dialog).getByText("Сумма снова войдёт в выручку.")).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить запись" }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ workspaceId: "w1", refundId: REFUND_ID }))
    await waitFor(() => expect(getEntry).toHaveBeenCalledTimes(2))
    expect(onChanged).toHaveBeenCalled()
  })

  const unapplied = (over: Partial<PaymentJournalUnapplied> = {}): PaymentJournalUnapplied => ({
    paymentId: "p9",
    at: "2026-11-03T15:40:00.000Z",
    member: { userId: "u1", name: "Иван Петров", isMember: true },
    itemName: "БЖЖ 12",
    amount: 4000,
    refundable: 4000,
    currency: "RUB",
    provider: "YOOKASSA",
    activationError: "Тариф выключен",
    ...over,
  })

  it("refunds an unapplied online payment through the provider only and closes", async () => {
    refund.mockResolvedValue({ refund: cashRefund({ method: "ONLINE", amount: 4000 }), sale: null })
    const { onClose, onChanged } = renderSheet({ unapplied: unapplied() })
    expect(screen.getByText("Тариф выключен")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Иван Петров" }).getAttribute("href")).toBe(
      "/workspace/w1/users/u1",
    )
    await openRefundForm()
    expect(
      within(screen.getByRole("radiogroup", { name: "Как вернули" })).getAllByRole("radio"),
    ).toHaveLength(1)
    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "Тариф выключен" } })
    fireEvent.click(screen.getByRole("button", { name: /Вернуть 4.000 ₽/ }))
    const dialog = await screen.findByRole("dialog", { name: /Вернуть 4.000 ₽ на карту\?/ })
    fireEvent.click(within(dialog).getByRole("button", { name: /Вернуть 4.000 ₽/ }))
    await waitFor(() =>
      expect(refund).toHaveBeenCalledWith({
        workspaceId: "w1",
        data: { target: "unapplied", targetId: "p9", amount: 4000, method: "ONLINE", reason: "Тариф выключен" },
      }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalled()
  })

  it("names an unapplied buyer who left the club without a link", () => {
    renderSheet({
      unapplied: unapplied({ member: { userId: "u1", name: "Иван Петров", isMember: false } }),
    })
    expect(screen.queryByRole("link", { name: "Иван Петров" })).toBeNull()
    expect(screen.getByText("Ученика больше нет в клубе — верните деньги.")).toBeTruthy()
  })
})
