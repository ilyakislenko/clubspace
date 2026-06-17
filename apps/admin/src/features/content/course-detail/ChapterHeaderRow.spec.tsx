/** @jest-environment jsdom */
import { DndContext } from "@dnd-kit/core"
import { SortableContext } from "@dnd-kit/sortable"
import { fireEvent, render, screen } from "@testing-library/react"

import { type CoursePlaylistChapter } from "../../../shared/api/playlists"
import { ChapterHeaderRow } from "./ChapterHeaderRow"
import { chapterDragId } from "./helpers"

const chapter = { id: "c1", title: "Атаки с гарда", order: 0 } as CoursePlaylistChapter

const renderRow = (
  over: Partial<React.ComponentProps<typeof ChapterHeaderRow>> = {},
) => {
  const onRename = jest.fn()
  const onDelete = jest.fn()
  const props = {
    chapter,
    onRename,
    onDelete,
    reordering: false,
    ...over,
  } as React.ComponentProps<typeof ChapterHeaderRow>
  render(
    <DndContext>
      <SortableContext items={[chapterDragId(props.chapter?.id ?? null)]}>
        <ul>
          <ChapterHeaderRow {...props} />
        </ul>
      </SortableContext>
    </DndContext>,
  )
  return { onRename, onDelete }
}

describe("ChapterHeaderRow", () => {
  it("renders the ungrouped pseudo-chapter without edit/delete affordances", () => {
    renderRow({ chapter: null })
    expect(screen.getByText("Без раздела")).toBeTruthy()
    expect(screen.queryByLabelText("Удалить раздел")).toBeNull()
  })

  it("renames on Enter when the title actually changed", () => {
    const { onRename } = renderRow()
    fireEvent.click(screen.getByText("Атаки с гарда"))
    const input = screen.getByRole("textbox") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Защита гарда" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onRename).toHaveBeenCalledWith("c1", "Защита гарда")
  })

  it("does not rename when the title is unchanged", () => {
    const { onRename } = renderRow()
    fireEvent.click(screen.getByText("Атаки с гарда"))
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(onRename).not.toHaveBeenCalled()
  })

  it("cancels editing on Escape without renaming", () => {
    const { onRename } = renderRow()
    fireEvent.click(screen.getByText("Атаки с гарда"))
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Что-то" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText("Атаки с гарда")).toBeTruthy()
  })

  it("deletes via the trash affordance", () => {
    const { onDelete } = renderRow()
    fireEvent.click(screen.getByLabelText("Удалить раздел"))
    expect(onDelete).toHaveBeenCalledWith(chapter)
  })
})
