/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/messages", () => ({
  previewClubMessage: jest.fn(),
  sendClubMessage: jest.fn(),
}))
jest.mock("../../shared/api/groups", () => ({ listGroups: jest.fn() }))
jest.mock("../../shared/api/me", () => ({ fetchMe: jest.fn() }))
jest.mock("../../shared/lib/use-my-membership", () => ({ useMyMembership: jest.fn() }))
jest.mock("../directions/use-directions", () => ({
  useDirections: () => ({ directions: [], reload: jest.fn() }),
}))

import { listGroups } from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import {
  previewClubMessage,
  sendClubMessage,
  type ClubMessagePreview,
} from "../../shared/api/messages"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { ComposeMessageSheet, type ComposePrefill } from "./ComposeMessageSheet"

const previewMock = previewClubMessage as jest.Mock
const sendMock = sendClubMessage as jest.Mock
const membershipMock = useMyMembership as jest.Mock

const ME = "11111111-2222-4333-8444-555555555555"
const STUDENT = "22222222-2222-4333-8444-555555555555"

const preview = (over: Partial<ClubMessagePreview> = {}): ClubMessagePreview => ({
  recipients: 52,
  children: 0,
  withPush: 40,
  optedOut: 4,
  muted: 0,
  noDevice: 8,
  capped: 0,
  withEmail: 0,
  emailAllowance: null,
  emailEnabled: false,
  // Midday in Tomsk: no quiet hours.
  sendAt: "2026-11-26T05:00:00.000Z",
  deferredByQuietHours: false,
  timezone: "Asia/Tomsk",
  limits: { clubLeft: 9, senderLeft: null, directLeft: 50, urgentLeft: 2 },
  ...over,
})

const group = (id: string, name: string, coachId: string) => ({
  id,
  name,
  gym: null,
  direction: null,
  coach: { id: coachId, email: null, firstname: null, lastname: null },
  bookingMode: "FIXED" as const,
  coaches: [{ userId: coachId, email: null, firstname: null, lastname: null, role: "primary" as const }],
  memberCount: 10,
  week: [],
})

const renderSheet = (prefill: ComposePrefill | null = null) => {
  const handlers = { onClose: jest.fn(), onSent: jest.fn() }
  render(
    <>
      <ComposeMessageSheet workspaceId="w1" open prefill={prefill} {...handlers} />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

const segmentOptions = () =>
  within(screen.getByLabelText("Кому"))
    .getAllByRole("option")
    .map((o) => o.textContent)

const fill = () => {
  fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "Тренировки не будет" } })
  fireEvent.change(screen.getByLabelText("Текст"), { target: { value: "Зал закрыт на ремонт." } })
}

beforeEach(() => {
  previewMock.mockReset().mockResolvedValue(preview())
  sendMock.mockReset().mockResolvedValue({ id: "m1" })
  ;(listGroups as jest.Mock).mockResolvedValue({
    data: [group("g1", "Дети", ME), group("g2", "Взрослые", "someone-else")],
    total: 2,
  })
  ;(fetchMe as jest.Mock).mockResolvedValue({ id: ME })
})

describe("ComposeMessageSheet — who may write to whom", () => {
  it("offers a sport lead renewals, debts and the service flag", async () => {
    membershipMock.mockReturnValue({ role: "head_coach", isOwner: false })
    renderSheet()
    await waitFor(() => expect(segmentOptions()).toContain("Группы"))
    expect(segmentOptions()).toEqual([
      "Все ученики",
      "Группы",
      "Пора продлить",
      "Не оплатили",
      "Не были 30 дней",
      "Кому позвонить",
    ])
    expect(screen.getByLabelText(/Служебное/)).toBeTruthy()
  })

  it("gives a plain coach own students and own groups only, no service flag", async () => {
    membershipMock.mockReturnValue({ role: "coach", isOwner: false })
    renderSheet()
    await waitFor(() => expect(segmentOptions()).toContain("Группы"))
    expect(segmentOptions()).toEqual([
      "Все мои ученики",
      "Группы",
      "Не были 30 дней",
      "Кому позвонить",
    ])
    expect(screen.queryByLabelText(/Служебное/)).toBeNull()
    fireEvent.change(screen.getByLabelText("Кому"), { target: { value: "GROUPS" } })
    const chips = within(screen.getByRole("group", { name: "Группы" })).getAllByRole("button")
    expect(chips.map((c) => c.textContent)).toEqual(["Дети"])
  })
})

describe("ComposeMessageSheet — sending", () => {
  beforeEach(() => membershipMock.mockReturnValue({ role: "admin", isOwner: false }))

  it("asks with the count before sending to more than one student", async () => {
    const { onSent, onClose } = renderSheet()
    fill()
    await screen.findByText(/Получат 52 ученика/)
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }))
    const title = await screen.findByText("Отправить 52 ученикам?")
    const dialog = title.closest('[role="dialog"]') as HTMLElement
    expect(sendMock).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Отправить" }))
    await waitFor(() => expect(sendMock).toHaveBeenCalled())
    expect(sendMock.mock.calls[0][0]).toEqual({
      workspaceId: "w1",
      data: {
        segment: "ALL",
        isService: false,
        urgent: false,
        withEmail: false,
        title: "Тренировки не будет",
        body: "Зал закрыт на ремонт.",
      },
    })
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it("sends a direct message from the call list at once, logging the contact", async () => {
    previewMock.mockResolvedValue(preview({ recipients: 1, withPush: 1, optedOut: 0, noDevice: 0 }))
    renderSheet({ segment: "MEMBERS", memberIds: [STUDENT], label: "Иван Петров", logContact: true })
    expect(screen.getByText("Личное сообщение")).toBeTruthy()
    expect(screen.getByText("Иван Петров")).toBeTruthy()
    fill()
    await screen.findByText(/Получит 1 ученик/)
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }))
    await waitFor(() => expect(sendMock).toHaveBeenCalled())
    expect(screen.queryByText(/ученикам\?$/)).toBeNull()
    expect(sendMock.mock.calls[0][0].data).toMatchObject({
      segment: "MEMBERS",
      memberIds: [STUDENT],
      logContact: true,
    })
  })

  it("shows the server's limit refusal inline and keeps the draft", async () => {
    previewMock.mockResolvedValue(preview({ recipients: 1 }))
    sendMock.mockRejectedValue(
      Object.assign(new Error("Bad Request"), {
        isAxiosError: true,
        response: { status: 400, data: { message: "Сегодня клуб уже отправил 10 рассылок — следующая завтра" } },
      }),
    )
    renderSheet()
    fill()
    await screen.findByText(/Получит 1 ученик/)
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }))
    expect(await screen.findByText("Сегодня клуб уже отправил 10 рассылок — следующая завтра")).toBeTruthy()
    expect((screen.getByLabelText("Заголовок") as HTMLInputElement).value).toBe("Тренировки не будет")
  })

  it("names the quiet hours and schedules instead of sending", async () => {
    previewMock.mockResolvedValue(
      preview({ deferredByQuietHours: true, sendAt: "2099-01-02T02:00:00.000Z" }),
    )
    renderSheet()
    fill()
    expect(await screen.findByText(/Сейчас тихие часы: уйдёт/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Запланировать" })).toBeTruthy()
  })

  it("never confirms or sends with the count of the audience it was switched away from", async () => {
    const unpaid = Promise.withResolvers<ClubMessagePreview>()
    const answerUnpaid = unpaid.resolve
    previewMock.mockImplementation(({ data }: { data: { segment: string } }) =>
      data.segment === "UNPAID" ? unpaid.promise : Promise.resolve(preview({ recipients: 313 })),
    )
    renderSheet()
    fill()
    await screen.findByText(/Получат 313 учеников/)
    fireEvent.change(screen.getByLabelText("Кому"), { target: { value: "UNPAID" } })
    // The old count is gone and nothing can be sent until the new one arrives.
    expect(screen.queryByText(/Получат 313 учеников/)).toBeNull()
    expect(screen.getByText("Считаем получателей…")).toBeTruthy()
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(screen.queryByText(/ученикам\?$/)).toBeNull()

    await waitFor(() => expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ segment: "UNPAID" }) }),
    ))
    answerUnpaid(preview({ recipients: 5, withPush: 5, optedOut: 0, noDevice: 0 }))
    await screen.findByText(/Получат 5 учеников/)
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }))
    const title = await screen.findByText("Отправить 5 ученикам?")
    const dialog = title.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByRole("button", { name: "Отправить" }))
    await waitFor(() => expect(sendMock).toHaveBeenCalled())
    expect(sendMock.mock.calls[0][0].data.segment).toBe("UNPAID")
  })

  it("keeps sending off when the preview of the new audience failed", async () => {
    previewMock.mockImplementation(({ data }: { data: { segment: string } }) =>
      data.segment === "UNPAID"
        ? Promise.reject(
            Object.assign(new Error("Forbidden"), {
              isAxiosError: true,
              response: { status: 403, data: { message: "Нет доступа к этому списку" } },
            }),
          )
        : Promise.resolve(preview()),
    )
    renderSheet()
    fill()
    await screen.findByText(/Получат 52 ученика/)
    fireEvent.change(screen.getByLabelText("Кому"), { target: { value: "UNPAID" } })
    expect(await screen.findByText("Нет доступа к этому списку")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/Получат 52 ученика/)).toBeNull()
  })
})
