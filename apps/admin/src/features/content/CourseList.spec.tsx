/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

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

describe("CourseList", () => {
  it("marks a non-public course as a draft", () => {
    render(
      <CourseList
        workspaceId="w1"
        playlists={[playlist({ isPublic: false })]}
        loading={false}
      />,
    )
    expect(screen.getByText("Черновик")).toBeTruthy()
  })

  it("makes the whole row a link to the course page, with no row buttons", () => {
    render(
      <CourseList workspaceId="w1" playlists={[playlist()]} loading={false} />,
    )
    expect(
      screen.getByText("Closed Guard").closest("a")?.getAttribute("href"),
    ).toBe("/workspace/w1/content/courses/p1")
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })

  it("shows the empty state when there are no courses", () => {
    render(<CourseList workspaceId="w1" playlists={[]} loading={false} />)
    expect(screen.getByText("Курсов пока нет.")).toBeTruthy()
  })
})
