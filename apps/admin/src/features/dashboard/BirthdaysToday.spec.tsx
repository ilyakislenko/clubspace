/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/birthdays", () => ({
  listBirthdaysToday: jest.fn(),
}))
jest.mock("../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))

import { listBirthdaysToday, type BirthdayMember } from "../../shared/api/birthdays"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { BirthdaysToday } from "./BirthdaysToday"

const listMock = listBirthdaysToday as jest.Mock
const realtimeMock = useWorkspaceRealtime as jest.Mock

const member = (over: Partial<BirthdayMember> = {}): BirthdayMember => ({
  userId: "11111111-2222-4333-8444-555555555555",
  name: "Аня Смирнова",
  photoUrl: null,
  isDependent: true,
  turns: 7,
  groups: [{ id: "g1", name: "Дети 6–9" }],
  ...over,
})

beforeEach(() => {
  listMock.mockReset()
  realtimeMock.mockReset()
})

describe("BirthdaysToday", () => {
  it("renders nothing on a day without birthdays", async () => {
    listMock.mockResolvedValue({ date: "2026-11-26", members: [] })
    const { container } = render(<BirthdaysToday workspaceId="w1" />)
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ workspaceId: "w1" }))
    expect(container.innerHTML).toBe("")
  })

  it("renders nothing when the read fails", async () => {
    listMock.mockRejectedValue(new Error("boom"))
    const { container } = render(<BirthdaysToday workspaceId="w1" />)
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    expect(container.innerHTML).toBe("")
  })

  it("lists today's people; the age only for a child; a row opens the member card", async () => {
    listMock.mockResolvedValue({
      date: "2026-11-26",
      members: [
        member(),
        member({
          userId: "22222222-2222-4333-8444-555555555555",
          name: "Пётр Козлов",
          isDependent: false,
          turns: null,
          groups: [],
        }),
      ],
    })
    render(<BirthdaysToday workspaceId="w1" />)

    await screen.findByText("Дни рождения сегодня")
    const anya = screen.getByRole("link", { name: /Аня Смирнова/ })
    expect(anya.textContent).toContain("исполняется 7 лет")
    expect(anya.textContent).toContain("Дети 6–9")
    expect(anya.getAttribute("href")).toBe(
      "/workspace/w1/users/11111111-2222-4333-8444-555555555555",
    )
    const petr = screen.getByRole("link", { name: /Пётр Козлов/ })
    expect(petr.textContent).not.toContain("исполняется")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("reloads on the members signal", async () => {
    listMock.mockResolvedValue({ date: "2026-11-26", members: [] })
    render(<BirthdaysToday workspaceId="w1" />)
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
    expect(realtimeMock).toHaveBeenCalledWith("w1", ["members"], expect.any(Function))
    const onInvalidate = realtimeMock.mock.calls[0][2] as () => void
    onInvalidate()
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })
})
