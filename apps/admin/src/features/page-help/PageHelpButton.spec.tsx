/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }))
jest.mock("../../environments/environment", () => ({
  environment: { guidesBaseUrl: null, publicAppUrl: null },
}))

import { usePathname } from "next/navigation"

import { environment } from "../../environments/environment"
import { PageHelpButton } from "./PageHelpButton"

const pathnameMock = usePathname as jest.Mock
const env = environment as { guidesBaseUrl: string | null; publicAppUrl: string | null }
const W = "/workspace/7f0c2a4e-1111-4222-8333-444455556666"
const fetchMock = jest.fn()

const manifest = (base: string) => [
  {
    id: "owner-setup",
    role: "owner",
    title: "Зал, группа и абонемент",
    file: "owner-setup-20261128.mp4",
    poster: "owner-setup-20261128.jpg",
    durationSec: 125,
  },
  { id: "attendance", role: "coach", title: "Отметить посещения", file: `${base}/attendance.mp4` },
]

const openHelp = () => {
  fireEvent.click(screen.getByRole("button", { name: "Как работает этот раздел" }))
  return screen.getByRole("dialog")
}

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  env.guidesBaseUrl = null
  env.publicAppUrl = null
})

describe("PageHelpButton", () => {
  it("renders nothing on a page without help", () => {
    pathnameMock.mockReturnValue(`${W}/nope`)
    const { container } = render(<PageHelpButton />)
    expect(container.innerHTML).toBe("")
  })

  it("opens only on a click: purpose, actions, guides and the link to all of them", async () => {
    env.guidesBaseUrl = "https://s3.example.com/guides-a"
    env.publicAppUrl = "https://app.example.com"
    fetchMock.mockResolvedValue({ ok: true, json: async () => manifest(env.guidesBaseUrl ?? "") })
    pathnameMock.mockReturnValue(`${W}/schedule`)
    render(<PageHelpButton />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    const dialog = openHelp()
    expect(within(dialog).getByRole("heading", { name: "Как работает раздел «Расписание»" })).toBeTruthy()
    expect(within(dialog).getByText(/Календарь всех групп и событий клуба/)).toBeTruthy()
    expect(within(dialog).getByText("Что здесь можно сделать")).toBeTruthy()
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5)

    await waitFor(() => expect(dialog.querySelectorAll("video")).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledWith("https://s3.example.com/guides-a/guides.json")
    const [setup, attendance] = Array.from(dialog.querySelectorAll("video"))
    expect(setup.getAttribute("src")).toBe("https://s3.example.com/guides-a/owner-setup-20261128.mp4")
    expect(setup.getAttribute("poster")).toBe("https://s3.example.com/guides-a/owner-setup-20261128.jpg")
    expect(setup.getAttribute("preload")).toBe("metadata")
    expect(setup.hasAttribute("controls")).toBe(true)
    expect(attendance.hasAttribute("poster")).toBe(false)
    expect(within(dialog).getByText("Зал, группа и абонемент")).toBeTruthy()
    expect(within(dialog).getByText("2:05")).toBeTruthy()

    const all = within(dialog).getByRole("link", { name: "Все видеоинструкции" })
    expect(all.getAttribute("href")).toBe("https://app.example.com/help")
    expect(all.getAttribute("target")).toBe("_blank")
  })

  it("shows text only when the manifest can't be read", async () => {
    env.guidesBaseUrl = "https://s3.example.com/guides-b"
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    pathnameMock.mockReturnValue(`${W}/content`)
    render(<PageHelpButton />)
    const dialog = openHelp()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByRole("heading", { name: "Как работает раздел «Курсы и видео»" })).toBeTruthy()
    expect(dialog.querySelector("video")).toBeNull()
    // No public site configured: no link to nowhere.
    expect(within(dialog).queryByRole("link", { name: "Все видеоинструкции" })).toBeNull()
  })

  it("asks for no manifest without a guides address or on a page without guides", () => {
    pathnameMock.mockReturnValue(`${W}/schedule`)
    const { unmount } = render(<PageHelpButton />)
    openHelp()
    unmount()

    env.guidesBaseUrl = "https://s3.example.com/guides-c"
    pathnameMock.mockReturnValue(`${W}/users/messages`)
    render(<PageHelpButton />)
    openHelp()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
