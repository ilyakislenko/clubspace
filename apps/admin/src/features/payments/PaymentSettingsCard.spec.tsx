/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/payments", () => ({
  getPaymentSettings: jest.fn(),
  updatePaymentSettings: jest.fn(),
  disconnectPayments: jest.fn(),
  checkPaymentConnection: jest.fn(),
}))

import {
  getPaymentSettings,
  updatePaymentSettings,
  type PaymentSettings,
} from "../../shared/api/payments"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PaymentSettingsCard } from "./PaymentSettingsCard"

const getMock = getPaymentSettings as jest.Mock
const updateMock = updatePaymentSettings as jest.Mock

const settings = (over: Partial<PaymentSettings> = {}): PaymentSettings => ({
  connected: true,
  provider: "YOOKASSA",
  shopId: "123456",
  secretKeyMasked: "••••1234",
  webhookSecretSet: false,
  receiptEnabled: true,
  vatCode: 1,
  paymentSubject: "service",
  paymentMode: "full_prepayment",
  verifiedAt: null,
  webhookUrls: { yookassa: "https://api/yk", stripe: "https://api/st" },
  onlinePlanCount: 2,
  autopayOffered: true,
  autopayEnabled: false,
  autopayLastError: null,
  autopayLastErrorAt: null,
  autopayLiveCount: 0,
  ...over,
})

const AUTOPAY = "Автоплатежи для учеников"

const renderCard = async (s: PaymentSettings) => {
  getMock.mockResolvedValue(s)
  render(
    <>
      <PaymentSettingsCard workspaceId="w1" />
      <ConfirmDialogHost />
    </>,
  )
  await screen.findByText("Платёжная система")
}

const autopayBox = () => screen.getByRole("checkbox", { name: AUTOPAY }) as HTMLInputElement
const save = () => fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))

beforeEach(() => {
  getMock.mockReset()
  updateMock.mockReset()
})

describe("PaymentSettingsCard — member autopay", () => {
  it("is saved with the card's «Сохранить» for a club on ЮKassa", async () => {
    updateMock.mockResolvedValue(settings({ autopayEnabled: true }))
    await renderCard(settings())
    fireEvent.click(autopayBox())
    save()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      provider: "YOOKASSA",
      autopayEnabled: true,
    })
    expect(autopayBox().checked).toBe(true)
  })

  it("is hidden while the platform doesn't offer it, and never sent", async () => {
    updateMock.mockResolvedValue(settings({ autopayOffered: false }))
    await renderCard(settings({ autopayOffered: false }))
    expect(screen.queryByRole("checkbox", { name: AUTOPAY })).toBeNull()
    save()
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).not.toHaveProperty("autopayEnabled")
  })

  it("explains that a Stripe club has no autopay", async () => {
    await renderCard(settings({ provider: "STRIPE", shopId: null, webhookSecretSet: true }))
    expect(screen.queryByRole("checkbox", { name: AUTOPAY })).toBeNull()
    expect(screen.getByText("Автоплатежи доступны только с ЮKassa")).toBeTruthy()
  })

  it("shows ЮKassa's refusal", async () => {
    await renderCard(
      settings({
        autopayEnabled: true,
        autopayLastError: "магазину не разрешены автоплатежи",
        autopayLastErrorAt: "2026-11-15T09:00:00.000Z",
      }),
    )
    const line = screen.getByText(/ЮKassa отказала в подключении автоплатежа/)
    expect(line.className).toContain("text-destructive")
    expect(line.textContent).toContain("магазину не разрешены автоплатежи")
    expect(line.textContent).toContain("Проверьте у менеджера ЮKassa")
  })

  it("asks before turning off live agreements, and keeps them when declined", async () => {
    await renderCard(settings({ autopayEnabled: true, autopayLiveCount: 3 }))
    expect(screen.getByText("Автоплатёж включён у 3 учеников")).toBeTruthy()
    fireEvent.click(autopayBox())
    save()
    const dialog = await screen.findByRole("dialog", { name: "Отключить автоплатежи?" })
    expect(dialog.textContent).toContain("Автоплатёж отключится у 3 учеников")
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(updateMock).not.toHaveBeenCalled()

    updateMock.mockResolvedValue(settings({ autopayEnabled: false }))
    save()
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Отключить автоплатежи?" })).getByRole("button", {
        name: "Отключить",
      }),
    )
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({ autopayEnabled: false })
  })

  it("warns that another shop ends live agreements", async () => {
    await renderCard(settings({ autopayEnabled: true, autopayLiveCount: 1 }))
    fireEvent.change(screen.getByPlaceholderText("123456"), { target: { value: "654321" } })
    save()
    const dialog = await screen.findByRole("dialog", { name: "Сменить магазин?" })
    expect(dialog.textContent).toContain("Автоплатёж отключится у 1 ученика")
  })
})
