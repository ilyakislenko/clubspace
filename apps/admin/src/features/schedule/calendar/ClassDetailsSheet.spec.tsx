/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/groups", () => ({
  createGroupException: jest.fn(),
  deleteGroupException: jest.fn(),
  deleteGroupSlot: jest.fn(),
  getGroup: jest.fn(),
  updateGroupSlot: jest.fn(),
}))
jest.mock("../ClassSubstitutionPanel", () => ({
  ClassSubstitutionPanel: () => null,
}))
jest.mock("../ClassAttendancePanel", () => ({
  ClassAttendancePanel: () => null,
}))
jest.mock("../ClassBookingPanel", () => ({ ClassBookingPanel: () => null }))

import {
  createGroupException,
  deleteGroupException,
  deleteGroupSlot,
  getGroup,
  updateGroupSlot,
} from "../../../shared/api/groups"
import { sessionAt } from "./calendar-fixtures"
import { buildCalendarItems, EMPTY_FILTERS, type ClassItem } from "./calendar-items"
import { ClassDetailsSheet, dayBefore } from "./ClassDetailsSheet"

const SLOT = {
  id: "slot-g1",
  dayOfWeek: 3,
  startTime: "19:00",
  durationMin: 90,
  effectiveFrom: "2026-09-01",
  effectiveUntil: null,
  capacity: null,
}

const details = (patch: object = {}) => ({
  id: "g1",
  name: "Группа g1",
  gym: { id: "gym1", name: "Зал gym1", address: "—" },
  direction: null,
  coach: { id: "c1", email: null, firstname: "Роман", lastname: "Савельев" },
  coaches: [],
  bookingMode: "FIXED",
  capacity: null,
  bookingWindowDays: null,
  bookingCancelHours: null,
  memberCount: 12,
  week: [{ dayOfWeek: 3, startTime: "19:00" }],
  slots: [SLOT],
  exceptions: [],
  canEdit: true,
  ...patch,
})

// The Wednesday 19:00 class of 2026-11-04, editable unless cancelled.
const classItem = (cancelled = false): ClassItem =>
  buildCalendarItems(
    {
      sessions: [
        sessionAt("2026-11-04", "19:00", {
          durationMin: 90,
          cancelled,
          cancellationReason: cancelled ? "Каникулы" : null,
        }),
      ],
      events: [],
    },
    {
      filters: EMPTY_FILTERS,
      onlyGroupIds: null,
      canEdit: (s) => !s.cancelled,
    },
  )[0] as ClassItem

const renderSheet = (item: ClassItem, canManage = true) => {
  const handlers = {
    onCancelled: jest.fn(),
    onRestored: jest.fn(),
    onScheduleChanged: jest.fn(),
  }
  render(
    <ClassDetailsSheet
      workspaceId="w1"
      item={item}
      group={undefined}
      canManage={canManage}
      onClose={jest.fn()}
      onMoveRequest={jest.fn()}
      onChanged={jest.fn()}
      {...handlers}
    />,
  )
  return handlers
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getGroup as jest.Mock).mockResolvedValue(details())
  jest.spyOn(window, "confirm").mockReturnValue(true)
})

describe("ClassDetailsSheet — the calendar edits the group's time", () => {
  it("cancels a break of several days for the whole group (a vacation)", async () => {
    ;(createGroupException as jest.Mock).mockResolvedValue({ id: "e1" })
    const h = renderSheet(classItem())
    fireEvent.click(await screen.findByRole("button", { name: /^Отменить тренировку/ }))
    fireEvent.click(screen.getByLabelText(/Перерыв на несколько дней/))
    fireEvent.change(screen.getByLabelText(/Причина/), {
      target: { value: "Отпуск тренера" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }))
    await waitFor(() =>
      expect(createGroupException).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        data: {
          slotId: null,
          fromDate: "2026-11-04",
          untilDate: "2026-11-04",
          reason: "Отпуск тренера",
        },
      }),
    )
    expect(h.onCancelled).toHaveBeenCalled()
  })

  it("cancels only this class by default", async () => {
    ;(createGroupException as jest.Mock).mockResolvedValue({ id: "e1" })
    renderSheet(classItem())
    fireEvent.click(await screen.findByRole("button", { name: /^Отменить тренировку/ }))
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }))
    await waitFor(() =>
      expect(createGroupException).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            slotId: "slot-g1",
            fromDate: "2026-11-04",
            untilDate: "2026-11-04",
            reason: null,
          },
        }),
      ),
    )
  })

  it("ends the weekly class from this date, keeping the past", async () => {
    ;(updateGroupSlot as jest.Mock).mockResolvedValue({})
    const h = renderSheet(classItem())
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Убрать из расписания с этой даты/,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Убрать из расписания" }))
    await waitFor(() =>
      expect(updateGroupSlot).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        slotId: "slot-g1",
        data: { effectiveUntil: "2026-11-03" },
      }),
    )
    expect(deleteGroupSlot).not.toHaveBeenCalled()
    expect(h.onScheduleChanged).toHaveBeenCalled()
  })

  it("removes a weekly class that only starts on this date", async () => {
    ;(getGroup as jest.Mock).mockResolvedValue(details({ slots: [{ ...SLOT, effectiveFrom: "2026-11-04" }] }))
    ;(deleteGroupSlot as jest.Mock).mockResolvedValue({ status: "deleted" })
    renderSheet(classItem())
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Убрать из расписания с этой даты/,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Убрать из расписания" }))
    await waitFor(() =>
      expect(deleteGroupSlot).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        slotId: "slot-g1",
      }),
    )
    expect(updateGroupSlot).not.toHaveBeenCalled()
  })

  it("lifts a vacation of the whole group from one of its cancelled classes", async () => {
    ;(getGroup as jest.Mock).mockResolvedValue(
      details({
        exceptions: [
          {
            id: "vac",
            slotId: null,
            fromDate: "2026-11-01",
            untilDate: "2026-11-10",
            reason: "Каникулы",
          },
        ],
      }),
    )
    ;(deleteGroupException as jest.Mock).mockResolvedValue({
      status: "deleted",
    })
    const h = renderSheet(classItem(true))
    fireEvent.click(await screen.findByRole("button", { name: "Снять отмену" }))
    await waitFor(() =>
      expect(deleteGroupException).toHaveBeenCalledWith({
        workspaceId: "w1",
        groupId: "g1",
        exceptionId: "vac",
      }),
    )
    expect(window.confirm).toHaveBeenCalled()
    expect(h.onRestored).toHaveBeenCalled()
  })

  it("offers no time editing to a viewer who does not run the group", async () => {
    renderSheet(classItem(), false)
    await screen.findByText("Группа g1")
    expect(getGroup).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Убрать из расписания/ })).toBeNull()
  })
})

describe("dayBefore", () => {
  it("crosses month and year edges", () => {
    expect(dayBefore("2026-12-01")).toBe("2026-11-30")
    expect(dayBefore("2027-01-01")).toBe("2026-12-31")
    expect(dayBefore("2028-03-01")).toBe("2028-02-29")
  })
})
