/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { type TagResponse } from "../../../shared/api/tags"
import { TagSelectField } from "./TagSelectField"

const tags: TagResponse[] = [
  { id: "t1", name: "Гард", type: "position" },
  { id: "t2", name: "Замок", type: "submission" },
] as TagResponse[]

const setup = (
  over: Partial<React.ComponentProps<typeof TagSelectField>> = {},
) => {
  const onToggle = jest.fn()
  render(
    <TagSelectField
      tags={tags}
      tagsLoading={false}
      selectedTagIds={[]}
      saving={false}
      onToggle={onToggle}
      {...over}
    />,
  )
  return { onToggle }
}

describe("TagSelectField", () => {
  it("renders selected tags as chips", () => {
    setup({ selectedTagIds: ["t1"] })
    expect(screen.getByText("Гард")).toBeTruthy()
    expect(screen.queryByText("Теги не добавлены.")).toBeNull()
  })

  it("shows the empty hint with no selection", () => {
    setup({ selectedTagIds: [] })
    expect(screen.getByText("Теги не добавлены.")).toBeTruthy()
  })

  it("opens the picker and lists options", () => {
    setup()
    expect(screen.queryByPlaceholderText("Поиск тегов")).toBeNull()
    fireEvent.click(screen.getByLabelText("Добавить тег"))
    expect(screen.getByPlaceholderText("Поиск тегов")).toBeTruthy()
    expect(screen.getByText("position")).toBeTruthy()
    expect(screen.getByText("submission")).toBeTruthy()
  })

  it("toggles a tag from the picker", () => {
    const { onToggle } = setup()
    fireEvent.click(screen.getByLabelText("Добавить тег"))
    fireEvent.click(screen.getByText("Замок"))
    expect(onToggle).toHaveBeenCalledWith("t2")
  })

  it("removes a selected tag via its chip", () => {
    const { onToggle } = setup({ selectedTagIds: ["t1"] })
    fireEvent.click(screen.getByLabelText("Удалить тег Гард"))
    expect(onToggle).toHaveBeenCalledWith("t1")
  })

  it("filters options by the search query", () => {
    setup()
    fireEvent.click(screen.getByLabelText("Добавить тег"))
    fireEvent.change(screen.getByPlaceholderText("Поиск тегов"), {
      target: { value: "Замок" },
    })
    expect(screen.queryByText("position")).toBeNull()
    expect(screen.getByText("submission")).toBeTruthy()
  })
})
