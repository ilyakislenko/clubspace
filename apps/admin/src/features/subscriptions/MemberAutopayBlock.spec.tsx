/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/autopay", () => ({
  listMemberAutopays: jest.fn(),
  cancelMemberAutopay: jest.fn(),
}))

import {
  cancelMemberAutopay,
  listMemberAutopays,
  type MemberAutopay,
} from "../../shared/api/autopay"
import { MemberAutopayBlock } from "./MemberAutopayBlock"

const listMock = listMemberAutopays as jest.Mock
const cancelMock = cancelMemberAutopay as jest.Mock

const plain = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ")

const agreement = (over: Partial<MemberAutopay> = {}): MemberAutopay => ({
  id: "a1",
  planId: "p1",
  planName: "БЖЖ 12",
  status: "ACTIVE",
  needsActionReason: null,
  cardLabel: "карта •• 4444",
  termsAmount: 4000,
  currency: "RUB",
  termsDurationDays: 30,
  termsClassCount: null,
  nextCharge: { on: "2026-12-14", amount: 4000, kind: "term" },
  lastError: null,
  lastFailedOn: null,
  nextAttemptOn: null,
  newTerms: null,
  consentedAt: "2026-11-14T10:00:00.000Z",
  cancelledAt: null,
  cancelSource: null,
  cancelReason: null,
  cancelledBy: null,
  createdAt: "2026-11-14T10:00:00.000Z",
  ...over,
})

const renderBlock = () => render(<MemberAutopayBlock workspaceId="w1" userId="u1" />)

beforeEach(() => {
  listMock.mockReset()
  cancelMock.mockReset()
})

describe("MemberAutopayBlock", () => {
  it("renders nothing for a member without autopay", async () => {
    listMock.mockResolvedValue({ data: [] })
    const { container } = renderBlock()
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ workspaceId: "w1", userId: "u1" }))
    expect(container.innerHTML).toBe("")
  })

  it("shows the next charge with amount and card when the server sends them", async () => {
    listMock.mockResolvedValue({ data: [agreement()] })
    renderBlock()
    expect(plain((await screen.findByText(/Автоплатёж «БЖЖ 12»/)).textContent)).toBe(
      "Автоплатёж «БЖЖ 12» · следующее списание 14 дек. · 4 000 ₽ · карта •• 4444",
    )
  })

  it("shows no amount or card for a head coach (stripped by the server)", async () => {
    listMock.mockResolvedValue({
      data: [
        agreement({
          cardLabel: null,
          termsAmount: null,
          nextCharge: { on: "2026-12-14", amount: null, kind: "term" },
        }),
      ],
    })
    renderBlock()
    expect((await screen.findByText(/Автоплатёж «БЖЖ 12»/)).textContent).toBe(
      "Автоплатёж «БЖЖ 12» · следующее списание 14 дек.",
    )
  })

  it("says a stop in the destructive tone", async () => {
    listMock.mockResolvedValue({
      data: [
        agreement({
          status: "NEEDS_ACTION",
          needsActionReason: "CHARGE_FAILED",
          lastError: "недостаточно средств",
        }),
      ],
    })
    renderBlock()
    const stop = await screen.findByText(/Автоплатёж остановлен: недостаточно средств/)
    expect(stop.className).toContain("text-destructive")
  })

  it("lists a recently cancelled one muted, without actions", async () => {
    listMock.mockResolvedValue({
      data: [
        agreement({
          status: "CANCELLED",
          cancelledAt: "2026-12-01T12:00:00.000Z",
          cancelSource: "MEMBER",
        }),
      ],
    })
    renderBlock()
    expect(await screen.findByText("Автоплатёж «БЖЖ 12» отключён 1 дек. — учеником")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Действия с автоплатежом/ })).toBeNull()
  })

  it("switches autopay off with the member's reason, required", async () => {
    listMock.mockResolvedValueOnce({ data: [agreement()] })
    renderBlock()
    fireEvent.keyDown(await screen.findByRole("button", { name: "Действия с автоплатежом «БЖЖ 12»" }), {
      key: "Enter",
    })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отключить автоплатёж" }))

    const dialog = await screen.findByRole("dialog", { name: "Отключить автоплатёж?" })
    const submit = screen.getByRole("button", { name: "Отключить" }) as HTMLButtonElement
    expect(dialog).toBeTruthy()
    expect(submit.disabled).toBe(true)

    cancelMock.mockResolvedValue(agreement({ status: "CANCELLED" }))
    listMock.mockResolvedValueOnce({
      data: [
        agreement({
          status: "CANCELLED",
          cancelledAt: "2026-12-01T12:00:00.000Z",
          cancelSource: "STAFF",
          cancelledBy: { userId: "s1", name: "Анна" },
          cancelReason: "Попросил по телефону",
        }),
      ],
    })
    fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "  Попросил по телефону " } })
    fireEvent.click(submit)

    await waitFor(() =>
      expect(cancelMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        autopayId: "a1",
        data: { reason: "Попросил по телефону" },
      }),
    )
    expect(
      await screen.findByText("Автоплатёж «БЖЖ 12» отключён 1 дек. — Анна: Попросил по телефону"),
    ).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("keeps the dialog open with the server's error", async () => {
    listMock.mockResolvedValue({ data: [agreement()] })
    cancelMock.mockRejectedValue(new Error("Сеть недоступна"))
    renderBlock()
    fireEvent.keyDown(await screen.findByRole("button", { name: /Действия с автоплатежом/ }), {
      key: "Enter",
    })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отключить автоплатёж" }))
    fireEvent.change(await screen.findByLabelText("Причина"), { target: { value: "Попросил" } })
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }))
    expect(await screen.findByRole("dialog", { name: "Отключить автоплатёж?" })).toBeTruthy()
    await waitFor(() => expect(cancelMock).toHaveBeenCalled())
  })
})
