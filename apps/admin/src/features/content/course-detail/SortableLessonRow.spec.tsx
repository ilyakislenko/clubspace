/** @jest-environment jsdom */
import { DndContext } from "@dnd-kit/core"
import { SortableContext } from "@dnd-kit/sortable"
import { fireEvent, render, screen } from "@testing-library/react"

import { type CoursePlaylistVideo } from "../../../shared/api/playlists"
import { SortableLessonRow } from "./SortableLessonRow"

const video = {
  id: "v1",
  title: "Урок 1",
  status: "ready",
  thumbnailUrl: null,
  duration: 90,
} as CoursePlaylistVideo

const renderRow = (
  over: Partial<React.ComponentProps<typeof SortableLessonRow>> = {},
) => {
  const onOpen = jest.fn()
  const onRemove = jest.fn()
  const props = {
    video,
    index: 0,
    onOpen,
    onRemove,
    removing: false,
    reordering: false,
    ...over,
  } as React.ComponentProps<typeof SortableLessonRow>
  render(
    <DndContext>
      <SortableContext items={[props.video.id]}>
        <ul>
          <SortableLessonRow {...props} />
        </ul>
      </SortableContext>
    </DndContext>,
  )
  return { onOpen, onRemove }
}

describe("SortableLessonRow", () => {
  it("renders position, title, ready status and duration", () => {
    renderRow()
    expect(screen.getByText("№1")).toBeTruthy()
    expect(screen.getByText("Урок 1")).toBeTruthy()
    expect(screen.getByText("Готово")).toBeTruthy()
    expect(screen.getByText("1:30")).toBeTruthy()
  })

  it("opens the lesson when its body is clicked", () => {
    const { onOpen } = renderRow()
    fireEvent.click(screen.getByText("Урок 1"))
    expect(onOpen).toHaveBeenCalled()
  })

  it("removes the lesson via the Убрать button", () => {
    const { onRemove } = renderRow()
    fireEvent.click(screen.getByRole("button", { name: "Убрать" }))
    expect(onRemove).toHaveBeenCalled()
  })

  it("shows the removing state and disables the button", () => {
    renderRow({ removing: true })
    const btn = screen.getByRole("button", {
      name: "Убираем...",
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
