/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/invitations", () => ({
  listWorkspaceInvitations: jest.fn(),
  revokeWorkspaceInvitation: jest.fn(),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))

import {
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
} from "../../shared/api/invitations"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PendingInvitationsPanel } from "./PendingInvitationsPanel"

const list = listWorkspaceInvitations as jest.Mock
const revoke = revokeWorkspaceInvitation as jest.Mock

const invitation = {
  id: "i1",
  email: "ann@mail.ru",
  roleName: "coach" as const,
  groupId: null,
  invitedAt: "2026-11-01T10:00:00.000Z",
}

describe("PendingInvitationsPanel", () => {
  beforeEach(() => {
    list.mockReset()
    revoke.mockReset()
  })

  it("renders nothing while there are no invitations", async () => {
    list.mockResolvedValue({ data: [] })
    const { container } = render(
      <PendingInvitationsPanel workspaceId="w1" refreshKey={0} />,
    )
    await waitFor(() => expect(list).toHaveBeenCalledWith({ workspaceId: "w1" }))
    expect(container.textContent).toBe("")
  })

  it("lists invitations as awaiting acceptance", async () => {
    list.mockResolvedValue({ data: [invitation] })
    render(<PendingInvitationsPanel workspaceId="w1" refreshKey={0} />)
    expect(await screen.findByText("ann@mail.ru")).toBeTruthy()
    expect(screen.getByText("Ожидают принятия (1)")).toBeTruthy()
    expect(screen.getByText(/ожидает принятия с/)).toBeTruthy()
  })

  it("revokes only after the dialog is confirmed, and drops the row", async () => {
    list.mockResolvedValue({ data: [invitation] })
    revoke.mockResolvedValue({ status: "revoked" })
    render(
      <>
        <PendingInvitationsPanel workspaceId="w1" refreshKey={0} />
        <ConfirmDialogHost />
      </>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Отозвать" }))
    const dialog = await screen.findByRole("dialog")
    expect(revoke).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Отозвать" }))
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith({ workspaceId: "w1", invitationId: "i1" }),
    )
    await waitFor(() => expect(screen.queryByText("ann@mail.ru")).toBeNull())
  })

  it("shows the error when the list fails", async () => {
    list.mockRejectedValue(new Error("boom"))
    render(<PendingInvitationsPanel workspaceId="w1" refreshKey={0} />)
    expect(await screen.findByText(/boom|Не удалось загрузить приглашения/)).toBeTruthy()
  })
})
