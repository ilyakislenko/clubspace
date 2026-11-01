/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import {
  fetchPlatformDemoRequests,
  type PlatformDemoRequest,
} from "../../shared/api/platform"
import { contactHref, PlatformDemoRequests } from "./PlatformDemoRequests"

jest.mock("../../shared/api/platform", () => ({
  fetchPlatformDemoRequests: jest.fn(),
}))

const fetchMock = fetchPlatformDemoRequests as jest.MockedFunction<
  typeof fetchPlatformDemoRequests
>

const request = (i: number, over: Partial<PlatformDemoRequest> = {}): PlatformDemoRequest => ({
  id: `r${i}`,
  name: `Тренер ${i}`,
  clubName: `Клуб ${i}`,
  city: null,
  contact: "@coach_club",
  studentsCount: null,
  comment: null,
  consentAt: "2026-11-01T09:00:00.000Z",
  createdAt: "2026-11-01T09:00:00.000Z",
  ...over,
})

describe("contactHref", () => {
  it("opens a Telegram handle or link in Telegram", () => {
    expect(contactHref("@coach_club")).toBe("https://t.me/coach_club")
    expect(contactHref("https://t.me/coach_club")).toBe("https://t.me/coach_club")
  })

  it("dials a phone number", () => {
    expect(contactHref("+7 (913) 123-45-67")).toBe("tel:+79131234567")
    expect(contactHref("8 913 123 45 67")).toBe("tel:89131234567")
  })

  it("leaves anything else as plain text", () => {
    expect(contactHref("позвоните вечером")).toBeNull()
  })
})

describe("PlatformDemoRequests", () => {
  beforeEach(() => fetchMock.mockReset())

  it("shows the empty state", async () => {
    fetchMock.mockResolvedValue({ data: [] })
    render(<PlatformDemoRequests />)
    expect(await screen.findByText("Заявок пока нет.")).toBeTruthy()
  })

  it("lists a request with its details and a contact link", async () => {
    fetchMock.mockResolvedValue({
      data: [
        request(1, {
          city: "Томск",
          studentsCount: 350,
          comment: "Десять залов",
        }),
      ],
    })
    render(<PlatformDemoRequests />)
    expect(await screen.findByText("Клуб 1")).toBeTruthy()
    expect(screen.getByText("Томск")).toBeTruthy()
    expect(screen.getByText("350 учеников")).toBeTruthy()
    expect(screen.getByText("Десять залов")).toBeTruthy()
    expect(screen.getByText("@coach_club").getAttribute("href")).toBe(
      "https://t.me/coach_club",
    )
  })

  it("shows the first five and expands to all", async () => {
    fetchMock.mockResolvedValue({
      data: Array.from({ length: 7 }, (_, i) => request(i)),
    })
    render(<PlatformDemoRequests />)
    expect(await screen.findByText("Клуб 0")).toBeTruthy()
    expect(screen.queryByText("Клуб 6")).toBeNull()
    fireEvent.click(screen.getByText("Показать все (7)"))
    expect(screen.getByText("Клуб 6")).toBeTruthy()
  })

  it("reports a failed load", async () => {
    fetchMock.mockRejectedValue(new Error("network"))
    render(<PlatformDemoRequests />)
    expect(await screen.findByText(/Не удалось загрузить заявки на демо|network/)).toBeTruthy()
  })
})
