/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import {
  acceptOrganizationInvite,
  leaveOrganization,
  listClubOrganizations,
  updateOrganizationSharing,
  type ClubOrganizationLink,
} from "../../shared/api/organizations"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { ClubFederationSettings } from "./ClubFederationSettings"

jest.mock("../../shared/api/organizations", () => ({
  acceptOrganizationInvite: jest.fn(),
  declineOrganizationInvite: jest.fn(),
  leaveOrganization: jest.fn(),
  listClubOrganizations: jest.fn(),
  updateOrganizationSharing: jest.fn(),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({ useWorkspaceRealtime: jest.fn() }))

const listMock = listClubOrganizations as jest.MockedFunction<typeof listClubOrganizations>
const acceptMock = acceptOrganizationInvite as jest.MockedFunction<typeof acceptOrganizationInvite>
const leaveMock = leaveOrganization as jest.MockedFunction<typeof leaveOrganization>
const sharingMock = updateOrganizationSharing as jest.MockedFunction<typeof updateOrganizationSharing>

const link = (over: Partial<ClubOrganizationLink> = {}): ClubOrganizationLink => ({
  id: "l1",
  status: "INVITED",
  invitedAt: "2026-11-20T00:00:00.000Z",
  decidedAt: null,
  organization: {
    id: "o1",
    name: "Федерация БЖЖ Томской области",
    type: "GRAPPLING",
    city: "Томск",
    description: null,
    logoUrl: null,
  },
  sharing: {
    shareRegistry: true,
    shareMrr: false,
    shareRevenue30d: false,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
  },
  canAccept: true,
  ...over,
})

const renderPage = () =>
  render(
    <>
      <ClubFederationSettings workspaceId="w1" />
      <ConfirmDialogHost />
    </>,
  )

describe("ClubFederationSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("lets the owner accept with the toggles as set on the card", async () => {
    listMock.mockResolvedValue([link()])
    acceptMock.mockResolvedValue(link({ status: "ACTIVE" }))
    renderPage()
    expect(await screen.findByText("Федерация «Федерация БЖЖ Томской области» приглашает клуб")).toBeTruthy()
    // Money is off by default; the owner opens one figure before accepting.
    fireEvent.click(screen.getByRole("switch", { name: "Регулярный доход в месяц" }))
    fireEvent.click(screen.getByRole("button", { name: "Принять" }))
    await waitFor(() =>
      expect(acceptMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        linkId: "l1",
        sharing: expect.objectContaining({ shareMrr: true, shareRevenue30d: false, shareRegistry: true }),
      }),
    )
  })

  it("tells a non-owner admin that only the owner accepts, and still lets them decline", async () => {
    listMock.mockResolvedValue([link({ canAccept: false })])
    renderPage()
    expect(await screen.findByText("Принять может только владелец клуба")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Принять" })).toBeNull()
    expect(screen.getByRole("button", { name: "Отклонить" })).toBeTruthy()
    expect((screen.getByRole("switch", { name: "Реестр поясов" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("saves a member club's toggle at once", async () => {
    listMock.mockResolvedValue([link({ status: "ACTIVE" })])
    sharingMock.mockResolvedValue(link({ status: "ACTIVE" }))
    renderPage()
    fireEvent.click(await screen.findByRole("switch", { name: "Выручка за 30 дней" }))
    await waitFor(() =>
      expect(sharingMock).toHaveBeenCalledWith({ workspaceId: "w1", linkId: "l1", data: { shareRevenue30d: true } }),
    )
  })

  it("leaves only after a confirmation that names what the federation loses", async () => {
    listMock.mockResolvedValue([link({ status: "ACTIVE" })])
    leaveMock.mockResolvedValue(link({ status: "LEFT" }))
    renderPage()
    // Radix opens the «⋯» menu from the keyboard in jsdom.
    fireEvent.keyDown(await screen.findByRole("button", { name: /Действия: Федерация БЖЖ/ }), { key: "Enter" })
    fireEvent.click(await screen.findByText("Выйти из федерации"))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/перестанет видеть цифры клуба, реестр и записи/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Выйти" }))
    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith({ workspaceId: "w1", linkId: "l1" }))
  })

  it("says so when the club is in no federation", async () => {
    listMock.mockResolvedValue([link({ status: "LEFT" })])
    renderPage()
    expect(await screen.findByText("Клуб не состоит в федерациях.")).toBeTruthy()
    expect(screen.getByText("Клуб вышел из федерации «Федерация БЖЖ Томской области»")).toBeTruthy()
  })
})
