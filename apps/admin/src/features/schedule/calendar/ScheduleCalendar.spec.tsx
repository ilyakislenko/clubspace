/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/schedule", () => ({
  getSchedule: jest.fn(),
  moveGroupOccurrence: jest.fn(),
  splitGroupSlot: jest.fn(),
}))
jest.mock("../../../shared/api/groups", () => ({
  listGroups: jest.fn(),
  listGyms: jest.fn(),
  createGroupSlot: jest.fn(),
  deleteGroupSlot: jest.fn(),
  createGroupException: jest.fn(),
  deleteGroupException: jest.fn(),
}))
jest.mock("../../../shared/api/me", () => ({ fetchMe: jest.fn() }))
jest.mock("../../../shared/realtime/useWorkspaceRealtime", () => ({
  useWorkspaceRealtime: jest.fn(),
}))
jest.mock("../../directions/use-directions", () => ({
  useDirections: () => ({ directions: [], reload: jest.fn() }),
}))
jest.mock("../../../shared/workspace/use-direction-scope", () => ({
  useDirectionScope: jest.fn(),
}))
jest.mock("../ClassSubstitutionPanel", () => ({ ClassSubstitutionPanel: () => null }))
jest.mock("../ClassAttendancePanel", () => ({ ClassAttendancePanel: () => null }))
jest.mock("../ClassBookingPanel", () => ({ ClassBookingPanel: () => null }))

import { listGroups, listGyms } from "../../../shared/api/groups"
import { fetchMe } from "../../../shared/api/me"
import {
  getSchedule,
  moveGroupOccurrence,
  splitGroupSlot,
} from "../../../shared/api/schedule"
import { useDirectionScope } from "../../../shared/workspace/use-direction-scope"
import { sessionAt } from "./calendar-fixtures"
import { ScheduleCalendar } from "./ScheduleCalendar"

const scheduleMock = getSchedule as jest.Mock
const moveMock = moveGroupOccurrence as jest.Mock
const splitMock = splitGroupSlot as jest.Mock
const scopeMock = useDirectionScope as jest.Mock

const GROUP = {
  id: "g1",
  name: "Группа g1",
  gym: { id: "gym1", name: "Зал gym1" },
  direction: { id: "d1", name: "БЖЖ", color: "#2563eb", icon: null },
  coach: { id: "c1", email: null, firstname: "Роман", lastname: "Савельев" },
  coaches: [{ userId: "c1", email: null, firstname: "Роман", lastname: "Савельев", role: "primary" }],
  members: [],
  memberCount: 0,
  slots: [],
  exceptions: [],
  bookingMode: "FIXED",
}

const adminScope = {
  isAdmin: true,
  isDirectionManager: false,
  managedDirectionIds: [],
  canManageDirection: () => true,
  canEditSharedRow: () => true,
  allowedDirectionIds: undefined,
  filterOptions: <T,>(d: T[]) => d,
  defaultDirectionId: null,
}

const RECT = { left: 0, top: 0, width: 700, height: 2000, right: 700, bottom: 2000, x: 0, y: 0, toJSON: () => ({}) }
const ptr = (type: string, clientX: number, clientY: number) =>
  Object.assign(new MouseEvent(type, { clientX, clientY, bubbles: true, button: 0 }), { pointerId: 1 })

beforeAll(() => {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => RECT as DOMRect)
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id))
  jest.useFakeTimers({ now: new Date("2026-11-02T03:00:00.000Z"), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})

beforeEach(() => {
  window.history.replaceState(null, "", "/workspace/w1/schedule?view=week&date=2026-11-04")
  window.localStorage.clear()
  // Like the API: the class comes back only from a range that contains its day.
  scheduleMock.mockReset().mockImplementation(async (p: { from: string; to: string }) => ({
    timezone: "Asia/Tomsk",
    sessions:
      p.from <= "2026-11-04" && p.to >= "2026-11-04"
        ? [sessionAt("2026-11-04", "19:00", { durationMin: 90 })]
        : [],
    events: [],
  }))
  moveMock.mockReset()
  splitMock.mockReset()
  ;(listGroups as jest.Mock).mockResolvedValue({ data: [GROUP], total: 1 })
  ;(listGyms as jest.Mock).mockResolvedValue({ data: [{ id: "gym1", name: "Зал gym1" }], total: 1 })
  ;(fetchMe as jest.Mock).mockResolvedValue({ id: "c1" })
  scopeMock.mockReturnValue(adminScope)
})

// Drag the 19:00 Wednesday class to Thursday 20:15 (grid starts at 8:00).
const dragClass = async () => {
  const block = await screen.findByRole("button", { name: /Группа g1, 19:00–20:30/ })
  fireEvent(block, ptr("pointerdown", 250, 670 * 1.6))
  act(() => {
    window.dispatchEvent(ptr("pointermove", 350, 742 * 1.6))
  })
  act(() => {
    window.dispatchEvent(ptr("pointerup", 350, 742 * 1.6))
  })
}

describe("ScheduleCalendar", () => {
  it("loads the week from the deep link and shows the classes", async () => {
    render(<ScheduleCalendar workspaceId="w1" />)
    await screen.findByRole("button", { name: /Группа g1, 19:00–20:30/ })
    expect(scheduleMock).toHaveBeenCalledWith({ workspaceId: "w1", from: "2026-11-02", to: "2026-11-08" })
    expect(screen.getByText("2–8 ноября 2026")).toBeTruthy()
    expect(screen.getByText(/1 занятие/)).toBeTruthy()
  })

  it("moves only this class and offers to undo it", async () => {
    moveMock.mockResolvedValue({ slotId: "one-off", sessionDate: "2026-11-05", restored: false })
    render(<ScheduleCalendar workspaceId="w1" />)
    await dragClass()
    expect(await screen.findByText("Перенести занятие")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Только это занятие" }))
    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        slotId: "slot-g1",
        sessionDate: "2026-11-04",
        data: { newDate: "2026-11-05", startTime: "20:15", durationMin: 90, notify: true },
      }),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Отменить" }))
    await waitFor(() =>
      expect(moveMock).toHaveBeenLastCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        slotId: "one-off",
        sessionDate: "2026-11-05",
        data: { newDate: "2026-11-04", startTime: "19:00", durationMin: 90, notify: true },
      }),
    )
  })

  it("changes this and the following classes", async () => {
    splitMock.mockResolvedValue({
      slot: { id: "s2", dayOfWeek: 4, startTime: "20:15", durationMin: 90, effectiveFrom: "2026-11-05", effectiveUntil: null, capacity: null },
      previousSlotId: "slot-g1",
      merged: false,
    })
    render(<ScheduleCalendar workspaceId="w1" />)
    await dragClass()
    fireEvent.click(await screen.findByRole("button", { name: "Это и все следующие" }))
    await waitFor(() =>
      expect(splitMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        slotId: "slot-g1",
        data: { fromDate: "2026-11-04", newDate: "2026-11-05", startTime: "20:15", durationMin: 90, notify: true },
      }),
    )
    expect(await screen.findByText(/Расписание «Группа g1» изменено с 5 ноября/)).toBeTruthy()
  })

  it("shows a refused move inside the dialog", async () => {
    moveMock.mockRejectedValue(new Error("boom"))
    render(<ScheduleCalendar workspaceId="w1" />)
    await dragClass()
    fireEvent.click(await screen.findByRole("button", { name: "Только это занятие" }))
    expect(await screen.findByText(/boom|Не удалось перенести/)).toBeTruthy()
  })

  it("is read-only for a plain coach", async () => {
    scopeMock.mockReturnValue({ ...adminScope, isAdmin: false, canManageDirection: () => false })
    render(<ScheduleCalendar workspaceId="w1" />)
    await screen.findByRole("button", { name: /Группа g1/ })
    expect(document.querySelector("[data-calendar-cell]")).toBeNull()
    expect(document.querySelector("[data-resize-handle]")).toBeNull()
  })

  it("switches views", async () => {
    render(<ScheduleCalendar workspaceId="w1" />)
    await screen.findByRole("button", { name: /Группа g1/ })
    fireEvent.click(screen.getByRole("tab", { name: /Месяц/ }))
    await waitFor(() => expect(scheduleMock).toHaveBeenLastCalledWith({ workspaceId: "w1", from: "2026-10-26", to: "2026-12-06" }))
    fireEvent.click(screen.getByRole("tab", { name: /Список/ }))
    await screen.findByText(/среда, 4 ноября/i)
    fireEvent.click(screen.getByRole("tab", { name: /Год/ }))
    await waitFor(() => expect(scheduleMock).toHaveBeenCalledWith({ workspaceId: "w1", from: "2026-01-01", to: "2026-03-31" }))
    fireEvent.click(screen.getByRole("tab", { name: /День/ }))
    await waitFor(() => expect(scheduleMock).toHaveBeenLastCalledWith({ workspaceId: "w1", from: "2026-11-04", to: "2026-11-04" }))
  })

  describe("day with every hall", () => {
    beforeEach(() => {
      window.history.replaceState(null, "", "/workspace/w1/schedule?view=day&date=2026-11-04")
      ;(listGroups as jest.Mock).mockResolvedValue({
        data: [GROUP, { ...GROUP, id: "g2", name: "Группа g2", gym: { id: "gym2", name: "Зал gym2" } }],
        total: 2,
      })
      ;(listGyms as jest.Mock).mockResolvedValue({
        data: [
          { id: "gym1", name: "Зал gym1", address: "—" },
          { id: "gym2", name: "Зал gym2", address: "—" },
        ],
        total: 2,
      })
    })

    const hallNames = () => [...document.querySelectorAll("[data-calendar-hall]")].map((h) => h.getAttribute("data-calendar-hall"))

    it("opens hall by hall and offers only the hall's groups in its empty cell", async () => {
      render(<ScheduleCalendar workspaceId="w1" />)
      await screen.findByRole("button", { name: /Группа g1, 19:00–20:30/ })
      await waitFor(() => expect(hallNames()).toEqual(["Зал gym1", "Зал gym2"]))
      expect(screen.getByRole("button", { name: /По залам/ }).getAttribute("aria-pressed")).toBe("true")
      fireEvent.click(screen.getByRole("button", { name: "Новое занятие 18:45, Зал gym2" }))
      expect(await screen.findByText(/Зал: Зал gym2/)).toBeTruthy()
    })

    it("switches to one shared column and remembers it", async () => {
      const { unmount } = render(<ScheduleCalendar workspaceId="w1" />)
      await screen.findByRole("button", { name: /Группа g1/ })
      fireEvent.click(screen.getByRole("button", { name: /Общая/ }))
      await waitFor(() => expect(hallNames()).toEqual([]))
      expect(JSON.parse(window.localStorage.getItem("clubspace:schedule-calendar") ?? "{}")).toMatchObject({ dayLayout: "combined" })
      unmount()
      render(<ScheduleCalendar workspaceId="w1" />)
      await screen.findByRole("button", { name: /Группа g1/ })
      expect(screen.getByRole("button", { name: /Общая/ }).getAttribute("aria-pressed")).toBe("true")
      expect(hallNames()).toEqual([])
    })

    it("is not offered in the week", async () => {
      window.history.replaceState(null, "", "/workspace/w1/schedule?view=week&date=2026-11-04")
      render(<ScheduleCalendar workspaceId="w1" />)
      await screen.findByRole("button", { name: /Группа g1/ })
      expect(screen.queryByRole("group", { name: "Раскладка дня" })).toBeNull()
      expect(hallNames()).toEqual([])
    })
  })
})
