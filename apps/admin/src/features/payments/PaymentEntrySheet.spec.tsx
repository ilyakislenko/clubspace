/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/payment-journal", () => ({
  getPaymentJournalEntry: jest.fn(),
}))
jest.mock("../../shared/api/payments", () => ({
  refundPayment: jest.fn(),
}))

import {
  getPaymentJournalEntry,
  type PaymentJournalEntryDetail,
  type PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { refundPayment } from "../../shared/api/payments"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PaymentEntrySheet } from "./PaymentEntrySheet"

const getEntry = getPaymentJournalEntry as jest.Mock
const refund = refundPayment as jest.Mock

const detail = (over: Partial<PaymentJournalEntryDetail> = {}): PaymentJournalEntryDetail => ({
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
  refundedAmount: 0,
  refundable: 4000,
  online: null,
  reason: null,
  refundOf: null,
  refunds: [],
  memberHasCard: true,
  ...over,
})

const ONLINE = {
  paymentId: "p1",
  provider: "YOOKASSA" as const,
  providerRef: "ab12cd",
  status: "SUCCEEDED" as const,
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

beforeEach(() => {
  getEntry.mockReset()
  refund.mockReset()
})

describe("PaymentEntrySheet", () => {
  it("shows a cash payment's facts with the member's card and no refund", async () => {
    getEntry.mockResolvedValue(detail())
    renderSheet({ entryId: "sub:s1" })
    expect(await screen.findByText("Абонемент «БЖЖ 12»")).toBeTruthy()
    expect(getEntry).toHaveBeenCalledWith({ workspaceId: "w1", entryId: "sub:s1" })
    expect(screen.getByRole("link", { name: "Иван Петров" }).getAttribute("href")).toBe(
      "/workspace/w1/users/u1",
    )
    expect(screen.getByText("Наличные")).toBeTruthy()
    expect(screen.getByText("Анна Ли")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Вернуть деньги" })).toBeNull()
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

  it("refunds an online payment only after the dialog is confirmed", async () => {
    getEntry.mockResolvedValue(detail({ method: "ONLINE", markedBy: null, online: ONLINE }))
    refund.mockResolvedValue({})
    const { onChanged } = renderSheet({ entryId: "sub:s1" })
    expect(await screen.findByText(/ЮKassa · № …ab12cd · Оплачен/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Вернуть деньги" }))
    const dialog = await screen.findByRole("dialog", { name: /Вернуть 4.000 ₽ ученику Иван Петров\?/ })
    expect(refund).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Вернуть деньги" }))
    await waitFor(() => expect(refund).toHaveBeenCalledWith({ workspaceId: "w1", paymentId: "p1" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(await screen.findByText(/Деньги возвращены/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Вернуть деньги" })).toBeNull()
  })

  it("offers no refund once the online payment is refunded", async () => {
    getEntry.mockResolvedValue(detail({ method: "ONLINE", online: { ...ONLINE, status: "REFUNDED" } }))
    renderSheet({ entryId: "sub:s1" })
    expect(await screen.findByText(/Возвращён/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Вернуть деньги" })).toBeNull()
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

  it("refunds an unapplied online payment and closes", async () => {
    refund.mockResolvedValue({})
    const { onClose, onChanged } = renderSheet({ unapplied: unapplied() })
    expect(screen.getByText("Тариф выключен")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Иван Петров" }).getAttribute("href")).toBe(
      "/workspace/w1/users/u1",
    )
    fireEvent.click(screen.getByRole("button", { name: "Вернуть деньги" }))
    const dialog = await screen.findByRole("dialog", { name: /Вернуть 4.000 ₽/ })
    fireEvent.click(within(dialog).getByRole("button", { name: "Вернуть деньги" }))
    await waitFor(() => expect(refund).toHaveBeenCalledWith({ workspaceId: "w1", paymentId: "p9" }))
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
