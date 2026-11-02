/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react"

import { sessionAt } from "./calendar-fixtures"
import { buildCalendarItems, EMPTY_FILTERS } from "./calendar-items"
import { TimeGridView } from "./TimeGridView"

const WEEK = [
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08",
]

const items = buildCalendarItems(
  {
    sessions: [
      sessionAt("2026-11-04", "19:00", { durationMin: 90 }),
      sessionAt("2026-11-04", "19:30", { groupId: "g2", gymId: "gym2", coachId: "c2" }),
    ],
    events: [],
  },
  { filters: EMPTY_FILTERS, canEdit: () => true, onlyGroupIds: null },
)

// jsdom has no layout: the grid is 700px wide (100px per day) and starts at
// y=0, so with the 8:00 first hour y = (minute - 480) * 1.6.
const GRID_RECT = { left: 0, top: 0, width: 700, height: 2000, right: 700, bottom: 2000, x: 0, y: 0, toJSON: () => ({}) }

beforeAll(() => {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return GRID_RECT as DOMRect
  })
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id))
})

const baseProps = () => ({
  days: WEEK,
  items,
  today: "2026-11-02",
  nowMin: 10 * 60,
  hours: { from: 8, to: 22 },
  workingHours: { from: 9, to: 22 },
  canCreate: true,
  hasConflict: jest.fn(() => false),
  onCreateAt: jest.fn(),
  onOpenItem: jest.fn(),
  onDrop: jest.fn(),
})

// jsdom has no PointerEvent: a MouseEvent carrying the pointer id.
const ptr = (type: string, clientX: number, clientY: number, pointerId: number) =>
  Object.assign(new MouseEvent(type, { clientX, clientY, bubbles: true, button: 0 }), { pointerId })

const block = (key: string) =>
  document.querySelector(`[data-calendar-block="${key}"]`)?.parentElement as HTMLElement

describe("TimeGridView", () => {
  it("puts blocks on the time lines and overlapping ones side by side", () => {
    render(<TimeGridView {...baseProps()} />)
    const a = block("slot-g1:2026-11-04")
    const b = block("slot-g2:2026-11-04")
    // 19:00 is 11h below 8:00 → 11 * 96 = 1056px, 1px inside the line.
    expect(a.style.top).toBe("1057px")
    expect(a.style.height).toBe(`${90 * 1.6 - 2}px`)
    expect(a.style.width).toBe("calc(50% - 4px)")
    expect(b.style.left).toBe("calc(50% + 2px)")
    expect(document.querySelectorAll("[data-hour-line]")).toHaveLength(7 * 14)
  })

  it("opens a class on click and creates on an empty 15-minute cell", () => {
    const props = baseProps()
    render(<TimeGridView {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Группа g1, 19:00–20:30/ }))
    expect(props.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ key: "slot-g1:2026-11-04" }))
    fireEvent.click(
      document.querySelector('[data-calendar-cell="2026-11-05 18:45"]') as HTMLElement,
    )
    expect(props.onCreateAt).toHaveBeenCalledWith({ date: "2026-11-05", startMin: 18 * 60 + 45 })
  })

  it("drags a class to another day and time snapped to 15 minutes", async () => {
    const props = baseProps()
    render(<TimeGridView {...props} />)
    const target = screen.getByRole("button", { name: /Группа g1, 19:00–20:30/ })
    // Grab 10 minutes into the class (19:10 → y = 670 * 1.6).
    fireEvent(target, ptr("pointerdown", 250, 670 * 1.6, 1))
    act(() => {
      // Thursday column, 20:22 at the pointer → start 20:12 → snapped 20:15.
      window.dispatchEvent(ptr("pointermove", 350, 742 * 1.6, 1))
    })
    expect(document.querySelector("[data-calendar-preview]")).not.toBeNull()
    act(() => {
      window.dispatchEvent(ptr("pointerup", 350, 742 * 1.6, 1))
    })
    expect(props.onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ key: "slot-g1:2026-11-04" }),
      { date: "2026-11-05", startMin: 20 * 60 + 15, endMin: 21 * 60 + 45 },
    )
    // The click that ends a drag does not open the panel.
    fireEvent.click(target)
    expect(props.onOpenItem).not.toHaveBeenCalled()
    // …but the next, separate click does.
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
    })
    fireEvent.click(target)
    expect(props.onOpenItem).toHaveBeenCalledTimes(1)
  })

  it("resizes from the bottom edge", () => {
    const props = baseProps()
    render(<TimeGridView {...props} />)
    const handle = block("slot-g1:2026-11-04").querySelector("[data-resize-handle]") as HTMLElement
    fireEvent(handle, ptr("pointerdown", 250, 750 * 1.6, 2))
    act(() => {
      window.dispatchEvent(ptr("pointermove", 250, 781 * 1.6, 2))
    })
    act(() => {
      window.dispatchEvent(ptr("pointerup", 250, 781 * 1.6, 2))
    })
    expect(props.onDrop).toHaveBeenCalledWith(expect.anything(), {
      date: "2026-11-04",
      startMin: 19 * 60,
      endMin: 21 * 60,
    })
  })

  it("Escape cancels a drag", () => {
    const props = baseProps()
    render(<TimeGridView {...props} />)
    const target = screen.getByRole("button", { name: /Группа g1/ })
    fireEvent(target, ptr("pointerdown", 250, 670 * 1.6, 3))
    act(() => {
      window.dispatchEvent(ptr("pointermove", 350, 742 * 1.6, 3))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(document.querySelector("[data-calendar-preview]")).toBeNull()
    act(() => {
      window.dispatchEvent(ptr("pointerup", 350, 742 * 1.6, 3))
    })
    expect(props.onDrop).not.toHaveBeenCalled()
  })

  describe("a column per hall", () => {
    const halls = [
      { id: "gym1", name: "Зал gym1", address: "ул. Ленина, 1", canCreate: true },
      { id: "gym2", name: "Зал gym2", address: "—", canCreate: true },
      { id: "gym3", name: "Зал gym3", address: "—", canCreate: false },
    ]
    const column = (name: string) => document.querySelector(`[data-calendar-column="${name}"]`) as HTMLElement

    it("puts each class into its hall's column at full width", () => {
      render(<TimeGridView {...baseProps()} days={["2026-11-04"]} halls={halls} />)
      expect([...document.querySelectorAll("[data-calendar-hall]")].map((h) => h.textContent)).toEqual([
        "Зал gym11 занятие",
        "Зал gym21 занятие",
        "Зал gym3нет занятий",
      ])
      // The two classes overlap in time but not in hall: no half-width blocks.
      expect(column("Зал gym1").contains(block("slot-g1:2026-11-04"))).toBe(true)
      expect(column("Зал gym2").contains(block("slot-g2:2026-11-04"))).toBe(true)
      expect(block("slot-g1:2026-11-04").style.width).toBe("calc(100% - 4px)")
      // The column names the hall; the block keeps the coach.
      expect(block("slot-g1:2026-11-04").textContent).toContain("Р. Савельев")
      expect(block("slot-g1:2026-11-04").textContent).not.toContain("Зал gym1")
    })

    it("widens a hall that runs classes side by side", () => {
      const twoInGym1 = buildCalendarItems(
        {
          sessions: [
            sessionAt("2026-11-04", "19:00"),
            sessionAt("2026-11-04", "19:00", { groupId: "g4", coachId: "c4" }),
          ],
          events: [],
        },
        { filters: EMPTY_FILTERS, canEdit: () => true, onlyGroupIds: null },
      )
      render(<TimeGridView {...baseProps()} items={twoInGym1} days={["2026-11-04"]} halls={halls} />)
      const grid = document.querySelector("[data-calendar-grid]") as HTMLElement
      expect(grid.style.gridTemplateColumns).toBe("minmax(22rem, 2fr) minmax(11rem, 1fr) minmax(11rem, 1fr)")
      expect(block("slot-g4:2026-11-04").style.width).toBe("calc(50% - 4px)")
    })

    it("creates in the hall of the cell, and only where the viewer has a group", () => {
      const props = baseProps()
      render(<TimeGridView {...props} days={["2026-11-04"]} halls={halls} />)
      expect(column("Зал gym3").querySelector("[data-calendar-cell]")).toBeNull()
      fireEvent.click(column("Зал gym2").querySelector('[data-calendar-cell="2026-11-04 18:45"]') as HTMLElement)
      expect(props.onCreateAt).toHaveBeenCalledWith({ date: "2026-11-04", startMin: 18 * 60 + 45, gymId: "gym2" })
    })

    it("moves a class in time only: dropping over another hall keeps its own", () => {
      const props = baseProps()
      render(<TimeGridView {...props} days={["2026-11-04"]} halls={halls} />)
      fireEvent(screen.getByRole("button", { name: /Группа g1, 19:00–20:30/ }), ptr("pointerdown", 50, 670 * 1.6, 4))
      act(() => {
        // Over the third hall, 20:22 at the pointer → 20:15.
        window.dispatchEvent(ptr("pointermove", 650, 742 * 1.6, 4))
      })
      expect(column("Зал gym1").querySelector("[data-calendar-preview]")).not.toBeNull()
      expect(column("Зал gym3").querySelector("[data-calendar-preview]")).toBeNull()
      act(() => {
        window.dispatchEvent(ptr("pointerup", 650, 742 * 1.6, 4))
      })
      expect(props.onDrop).toHaveBeenCalledWith(expect.objectContaining({ key: "slot-g1:2026-11-04" }), {
        date: "2026-11-04",
        startMin: 20 * 60 + 15,
        endMin: 21 * 60 + 45,
      })
    })
  })
})
