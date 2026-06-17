/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { type PlaylistResponse } from "../../shared/api/playlists"
import { CourseList } from "./CourseList"

const playlist = (over: Partial<PlaylistResponse> = {}): PlaylistResponse =>
  ({
    id: "p1",
    title: "Closed Guard",
    slug: "closed-guard",
    isPublic: true,
    thumbnailUrl: null,
    ...over,
  }) as PlaylistResponse

const noop = () => undefined

describe("CourseList", () => {
  beforeEach(() => push.mockClear())

  it("renders each course's title and slug", () => {
    render(
      <CourseList
        workspaceId="w1"
        playlists={[playlist()]}
        loading={false}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(screen.getByText("Closed Guard")).toBeTruthy()
    expect(screen.getByText("closed-guard")).toBeTruthy()
  })

  it("marks a non-public course as a draft", () => {
    render(
      <CourseList
        workspaceId="w1"
        playlists={[playlist({ isPublic: false })]}
        loading={false}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(screen.getByText("Черновик")).toBeTruthy()
  })

  it("fires onEdit / onDelete with the course", () => {
    const onEdit = jest.fn()
    const onDelete = jest.fn()
    const p = playlist()
    render(
      <CourseList
        workspaceId="w1"
        playlists={[p]}
        loading={false}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByText("Редактировать"))
    fireEvent.click(screen.getByText("Удалить"))
    expect(onEdit).toHaveBeenCalledWith(p)
    expect(onDelete).toHaveBeenCalledWith(p)
  })

  it("navigates to the course detail when the row is clicked", () => {
    render(
      <CourseList
        workspaceId="w1"
        playlists={[playlist()]}
        loading={false}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    fireEvent.click(screen.getByText("Closed Guard"))
    expect(push).toHaveBeenCalledWith("/workspace/w1/content/courses/p1")
  })

  it("shows the empty state when there are no courses", () => {
    render(
      <CourseList
        workspaceId="w1"
        playlists={[]}
        loading={false}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(screen.getByText("Курсов пока нет.")).toBeTruthy()
  })
})
