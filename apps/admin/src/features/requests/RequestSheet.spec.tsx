/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/members", () => ({
  addWorkspaceMember: jest.fn(),
  rejectPendingMember: jest.fn(),
}))
jest.mock("../../shared/api/subscriptions", () => ({
  approveSubscriptionFreezeRequest: jest.fn(),
  declineSubscriptionFreezeRequest: jest.fn(),
}))
jest.mock("../../shared/api/personal-trainings", () => ({
  acceptPersonalTraining: jest.fn(),
  proposePersonalTrainingTime: jest.fn(),
  declinePersonalTraining: jest.fn(),
}))
jest.mock("../../shared/api/video-reviews", () => ({
  getVideoReview: jest.fn(),
  getVideoReviewPlayback: jest.fn(),
  addVideoReviewComment: jest.fn(),
  deleteVideoReviewComment: jest.fn(),
  setVideoReviewStatus: jest.fn(),
}))
jest.mock("../../shared/api/requests", () => ({
  ...jest.requireActual("../../shared/api/requests"),
  listOpenRequests: jest.fn(),
}))

import { rejectPendingMember } from "../../shared/api/members"
import { acceptPersonalTraining } from "../../shared/api/personal-trainings"
import { listOpenRequests, type OpenRequest } from "../../shared/api/requests"
import { approveSubscriptionFreezeRequest } from "../../shared/api/subscriptions"
import { getVideoReview } from "../../shared/api/video-reviews"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { RequestSheet } from "./RequestSheet"

const reject = rejectPendingMember as jest.Mock
const approveFreeze = approveSubscriptionFreezeRequest as jest.Mock
const acceptPersonal = acceptPersonalTraining as jest.Mock
const getReview = getVideoReview as jest.Mock
const listRequests = listOpenRequests as jest.Mock

const member: OpenRequest["member"] = {
  userId: "u1",
  name: "Анна Петрова",
  email: "anna@example.com",
  isDependent: false,
  guardians: [],
}

const base = (over: Partial<OpenRequest>): OpenRequest => ({
  id: "join:m1",
  kind: "join",
  requestId: "u1",
  createdAt: "2026-11-15T09:00:00.000Z",
  member,
  join: { roleName: "user" },
  freeze: null,
  personal: null,
  video: null,
  ...over,
})

const freeze = base({
  id: "freeze:f1",
  kind: "freeze",
  requestId: "f1",
  join: null,
  freeze: {
    // Far ahead, so the form keeps the requested day (a past one becomes today).
    fromDate: "2099-01-10",
    untilDate: "2099-01-19",
    days: 10,
    reason: "Отпуск",
    planName: "Взрослые 12",
    subscriptionId: "s1",
    subscriptionEndDate: "2099-06-30T00:00:00.000Z",
  },
})

const personal = base({
  id: "personal:p1",
  kind: "personal",
  requestId: "p1",
  join: null,
  personal: {
    coach: { userId: "c1", name: "Олег Смирнов" },
    gymName: "Зал на Ленина",
    timezone: "Asia/Tomsk",
    memberComment: "После работы",
    options: [
      { id: "11111111-1111-4111-8111-111111111111", startAt: "2099-11-21T06:00:00.000Z", durationMin: 60 },
      { id: "22222222-2222-4222-8222-222222222222", startAt: "2099-11-22T06:00:00.000Z", durationMin: 90 },
    ],
  },
})

const processingVideo = base({
  id: "video:v1",
  kind: "video",
  requestId: "v1",
  join: null,
  video: { title: "Спарринг", message: null, clipStatus: "processing", durationSec: null, commentCount: 0 },
})

const renderSheet = (
  request: OpenRequest | null,
  over: { startInDecline?: boolean; listLoaded?: boolean; requestId?: string } = {},
) => {
  const handlers = { onClose: jest.fn(), onChanged: jest.fn() }
  render(
    <>
      <RequestSheet
        workspaceId="w1"
        requestId={over.requestId ?? request?.id ?? "freeze:gone"}
        request={request}
        listLoaded={over.listLoaded ?? true}
        viewerId="admin1"
        startInDecline={over.startInDecline ?? false}
        {...handlers}
      />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe("RequestSheet", () => {
  it("join: the row's «Отклонить» opens the decline form, which sends the comment with no dialog", async () => {
    reject.mockResolvedValue({ status: "rejected" })
    const { onClose, onChanged } = renderSheet(base({}), { startInDecline: true })
    expect(screen.getByText("Вступление · Анна Петрова")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Комментарий (увидит человек)"), {
      target: { value: "  Мест нет  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Отклонить заявку" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(reject).toHaveBeenCalledWith({ workspaceId: "w1", userId: "u1", comment: "Мест нет" })
    expect(onChanged).toHaveBeenCalled()
    expect(screen.queryByText("Уйти без сохранения?")).toBeNull()
  })

  it("freeze: «Одобрить» opens the card's form prefilled with the request", async () => {
    approveFreeze.mockResolvedValue({})
    const { onClose } = renderSheet(freeze)
    expect(screen.getByText("Взрослые 12, до 30.06.2099")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Одобрить" }))
    expect(screen.getByDisplayValue("10")).toBeTruthy()
    expect(screen.getByDisplayValue("2099-01-10")).toBeTruthy()
    expect(screen.getByDisplayValue("Отпуск")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Одобрить заморозку" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(approveFreeze).toHaveBeenCalledWith({
      workspaceId: "w1",
      requestId: "f1",
      data: { days: 10, fromDate: "2099-01-10", reason: "Отпуск" },
    })
  })

  it("personal: «Подтвердить» sends the chosen time; a lead acting for the coach is told", async () => {
    acceptPersonal.mockResolvedValue({})
    const { onClose } = renderSheet(personal)
    expect(
      screen.getByText("Вы отвечаете за Олег Смирнов: уведомление получат ученик и Олег Смирнов."),
    ).toBeTruthy()
    const [first, second] = screen.getAllByRole("radio")
    expect((first as HTMLInputElement).checked).toBe(true)
    fireEvent.click(second)
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(acceptPersonal).toHaveBeenCalledWith({
      workspaceId: "w1",
      requestId: "p1",
      data: { optionId: "22222222-2222-4222-8222-222222222222" },
    })
  })

  it("video: «Отметить отвеченным» waits for the processed clip", async () => {
    getReview.mockResolvedValue({ comments: [] })
    renderSheet(processingVideo)
    expect(screen.getByText("Видео ещё обрабатывается")).toBeTruthy()
    const answered = screen.getByRole("button", { name: "Отметить отвеченным" }) as HTMLButtonElement
    expect(answered.disabled).toBe(true)
    await waitFor(() => expect(getReview).toHaveBeenCalledWith({ workspaceId: "w1", requestId: "v1" }))
  })

  it("a decision someone made first (409) shows «Заявку уже рассмотрели» and no buttons", async () => {
    acceptPersonal.mockRejectedValue({
      response: { data: { code: "CONFLICT", message: "Статус заявки изменился — обновите экран" } },
    })
    const { onChanged, onClose } = renderSheet(personal)
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
    expect(await screen.findByText("Заявку уже рассмотрели")).toBeTruthy()
    expect(screen.getByText("Статус заявки изменился — обновите экран")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Подтвердить" })).toBeNull()
    expect(onChanged).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("a request that is in none of its kind's pages reads as decided", async () => {
    listRequests.mockResolvedValue({ data: [], total: 0 })
    renderSheet(null, { listLoaded: true })
    expect(await screen.findByText("Заявку уже рассмотрели")).toBeTruthy()
    expect(listRequests).toHaveBeenCalledWith(expect.objectContaining({ kind: "freeze", curPage: 1 }))
  })

  it("a deep link to a row the list hasn't loaded opens that request, not «уже рассмотрели»", async () => {
    listRequests.mockResolvedValue({ data: [freeze], total: 1 })
    renderSheet(null, { listLoaded: true, requestId: freeze.id })
    expect(await screen.findByText(/Заморозка/)).toBeTruthy()
    expect(screen.queryByText("Заявку уже рассмотрели")).toBeNull()
  })
})
