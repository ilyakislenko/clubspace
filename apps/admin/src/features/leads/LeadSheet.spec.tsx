/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/leads", () => ({
  getLead: jest.fn(),
  setLeadStatus: jest.fn(),
  updateLead: jest.fn(),
  linkLeadMember: jest.fn(),
  eraseLead: jest.fn(),
}))
jest.mock("../../shared/api/members", () => ({
  addWorkspaceDependent: jest.fn(),
  listWorkspaceMembers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
}))
jest.mock("../../shared/api/invites", () => ({
  inviteWorkspaceMember: jest.fn(),
}))
jest.mock("../../shared/api/groups", () => ({
  listGroups: jest.fn().mockResolvedValue({ data: [], total: 0 }),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))

import { eraseLead, getLead, linkLeadMember, setLeadStatus } from "../../shared/api/leads"
import { inviteWorkspaceMember } from "../../shared/api/invites"
import { addWorkspaceDependent } from "../../shared/api/members"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { leadFixture } from "./lead-fixtures"
import { LeadSheet } from "./LeadSheet"

const getMock = getLead as jest.Mock
const statusMock = setLeadStatus as jest.Mock
const eraseMock = eraseLead as jest.Mock
const linkMock = linkLeadMember as jest.Mock
const inviteMock = inviteWorkspaceMember as jest.Mock
const addChildMock = addWorkspaceDependent as jest.Mock

const renderSheet = () => {
  const onChanged = jest.fn()
  render(
    <>
      <LeadSheet workspaceId="w1" leadId="l1" onClose={jest.fn()} onChanged={onChanged} />
      <ConfirmDialogHost />
    </>,
  )
  return { onChanged }
}

// The «⋯» menu of the panel (Radix opens it from the keyboard in jsdom).
const openMenu = async () => {
  fireEvent.keyDown(await screen.findByRole("button", { name: "Ещё действия с заявкой" }), { key: "Enter" })
}

// Filled buttons are the default variant (bg-primary); the rest are not.
const filledButtons = () =>
  screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary"))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("LeadSheet", () => {
  it("shows one filled next step per state", async () => {
    for (const [status, filled, outline] of [
      ["NEW", "Связались", "Записать на пробное"],
      ["CONTACTED", "Записать на пробное", null],
      ["TRIAL_BOOKED", "Пришёл", "Перенести"],
      ["CAME", "Добавить в клуб", "Связать с учеником"],
      ["LOST", "Вернуть в работу", null],
    ] as const) {
      getMock.mockResolvedValue(leadFixture({ status }))
      const { unmount } = render(
        <LeadSheet workspaceId="w1" leadId="l1" onClose={jest.fn()} onChanged={jest.fn()} />,
      )
      await screen.findByRole("button", { name: filled })
      expect(filledButtons().map((b) => b.textContent)).toEqual([filled])
      if (outline) expect(screen.getByRole("button", { name: outline })).toBeTruthy()
      unmount()
    }
  })

  it("moves the status with the version it showed and reports the change", async () => {
    getMock.mockResolvedValue(leadFixture())
    statusMock.mockResolvedValue(leadFixture({ status: "CONTACTED", contactedAt: "2026-11-26T11:00:00.000Z" }))
    const { onChanged } = renderSheet()
    fireEvent.click(await screen.findByRole("button", { name: "Связались" }))
    await waitFor(() =>
      expect(statusMock).toHaveBeenCalledWith({ workspaceId: "w1", leadId: "l1", data: { from: "NEW", to: "CONTACTED" } }),
    )
    expect(await screen.findByRole("button", { name: "Записать на пробное" })).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it("on a 409 reloads the lead and shows the server's words", async () => {
    getMock.mockResolvedValueOnce(leadFixture()).mockResolvedValueOnce(leadFixture({ status: "CONTACTED" }))
    statusMock.mockRejectedValue({
      response: { status: 409, data: { message: "Статус заявки изменился — обновите экран" } },
    })
    renderSheet()
    fireEvent.click(await screen.findByRole("button", { name: "Связались" }))
    expect(await screen.findByText("Статус заявки изменился — обновите экран")).toBeTruthy()
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it("the lost form needs a reason, a comment for «Другое», and warns that spam erases", async () => {
    getMock.mockResolvedValue(leadFixture({ status: "CONTACTED" }))
    statusMock.mockResolvedValue(leadFixture({ status: "LOST", lostReason: "PRICE" }))
    renderSheet()
    await openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отказ…" }))
    fireEvent.click(screen.getByRole("button", { name: "Отметить отказ" }))
    expect(screen.getByText("Выберите причину")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Спам"))
    expect(screen.getByText("Данные удалятся сразу.")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Другое"))
    fireEvent.click(screen.getByRole("button", { name: "Отметить отказ" }))
    expect(screen.getByText("Напишите, что случилось")).toBeTruthy()
    expect(statusMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Не подошла цена"))
    fireEvent.click(screen.getByRole("button", { name: "Отметить отказ" }))
    await waitFor(() =>
      expect(statusMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        leadId: "l1",
        data: { from: "CONTACTED", to: "LOST", lostReason: "PRICE" },
      }),
    )
  })

  it("erases the personal data only after the confirmation", async () => {
    getMock.mockResolvedValue(leadFixture())
    eraseMock.mockResolvedValue(
      leadFixture({ name: null, phone: null, email: null, anonymizedAt: "2026-11-26T12:00:00.000Z" }),
    )
    renderSheet()
    await openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Удалить данные" }))
    const dialog = await screen.findByRole("dialog", { name: "Удалить данные заявки?" })
    expect(within(dialog).getByText(/Имя, телефон и комментарии сотрутся навсегда/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }))
    await waitFor(() => expect(eraseMock).toHaveBeenCalledWith({ workspaceId: "w1", leadId: "l1" }))
    expect(await screen.findByText("Имя, телефон и комментарии удалены.")).toBeTruthy()
  })

  it("«Добавить в клуб» on a child lead opens «Добавить ребёнка» prefilled and links the child", async () => {
    getMock.mockResolvedValue(
      leadFixture({ status: "CAME", forChild: true, childName: "Маша Петрова", childAge: 8, email: "anna@example.com" }),
    )
    addChildMock.mockResolvedValue({
      dependentId: "child-1",
      membershipId: "m1",
      guardianUserId: "g1",
      guardianIsNew: false,
      emailSent: true,
      groupId: null,
    })
    linkMock.mockResolvedValue(leadFixture({ status: "CAME", convertedUserId: "child-1" }))
    renderSheet()
    fireEvent.click(await screen.findByRole("button", { name: "Добавить в клуб" }))
    expect((screen.getByLabelText("Имя*") as HTMLInputElement).value).toBe("Маша")
    expect((screen.getByLabelText("Фамилия") as HTMLInputElement).value).toBe("Петрова")
    expect((screen.getByLabelText("E-mail родителя*") as HTMLInputElement).value).toBe("anna@example.com")
    expect(screen.getByText("по заявке: 8 лет")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Дата рождения*"), { target: { value: "2018-03-01" } })
    fireEvent.click(screen.getByRole("button", { name: "Добавить ребёнка" }))
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith({ workspaceId: "w1", leadId: "l1", userId: "child-1" }))
    expect(await screen.findByRole("link", { name: "Открыть карточку ученика" })).toBeTruthy()
  })

  it("an adult's invite links the new member; a failed link offers «Связать вручную»", async () => {
    getMock.mockResolvedValue(leadFixture({ status: "CAME", trialGroupId: null }))
    inviteMock.mockResolvedValue({
      userId: "u9",
      email: "anna@example.com",
      roleName: "user",
      outcome: "added",
      emailSent: true,
      groupId: null,
    })
    linkMock.mockRejectedValue({ response: { status: 400, data: { message: "Ученик не найден в клубе" } } })
    renderSheet()
    fireEvent.click(await screen.findByRole("button", { name: "Добавить в клуб" }))
    expect((screen.getByLabelText("E-mail*") as HTMLInputElement).value).toBe("anna@example.com")
    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe("Анна")
    fireEvent.click(screen.getByRole("button", { name: "Пригласить" }))
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith({ workspaceId: "w1", leadId: "l1", userId: "u9" }))
    expect(await screen.findByText(/Ученик добавлен, но заявку не удалось связать/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Связать вручную" })).toBeTruthy()
  })
})
