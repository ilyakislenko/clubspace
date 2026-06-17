/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/videos", () => ({ listVideos: jest.fn() }))
jest.mock("../../../shared/api/playlists", () => ({
  attachVideosToPlaylist: jest.fn(),
}))

import { attachVideosToPlaylist } from "../../../shared/api/playlists"
import { listVideos } from "../../../shared/api/videos"
import { AttachVideoSheet } from "./AttachVideoSheet"

const listMock = listVideos as jest.Mock
const attachMock = attachVideosToPlaylist as jest.Mock

const videos = [
  { id: "v1", title: "Дрилл 1", status: "ready", thumbnailUrl: null, duration: null },
  { id: "v2", title: "Дрилл 2", status: "ready", thumbnailUrl: null, duration: null },
]

const setup = (over: Partial<React.ComponentProps<typeof AttachVideoSheet>> = {}) => {
  const onAttached = jest.fn()
  const onOpenChange = jest.fn()
  const onError = jest.fn()
  render(
    <AttachVideoSheet
      workspaceId="w1"
      courseId="c1"
      open
      onOpenChange={onOpenChange}
      inCourseIds={new Set<string>()}
      onAttached={onAttached}
      onError={onError}
      {...over}
    />,
  )
  return { onAttached, onOpenChange, onError }
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({ data: videos })
  attachMock.mockReset().mockResolvedValue(undefined)
})

describe("AttachVideoSheet", () => {
  it("fetches and lists candidate videos on open", async () => {
    setup()
    expect(listMock).toHaveBeenCalled()
    expect(await screen.findByText("Дрилл 1")).toBeTruthy()
    expect(screen.getByText("Дрилл 2")).toBeTruthy()
  })

  it("hides videos already attached to the course", async () => {
    setup({ inCourseIds: new Set(["v1"]) })
    expect(await screen.findByText("Дрилл 2")).toBeTruthy()
    expect(screen.queryByText("Дрилл 1")).toBeNull()
  })

  it("keeps Добавить disabled until a video is picked", async () => {
    setup()
    await screen.findByText("Дрилл 1")
    const add = () =>
      screen.getByRole("button", { name: "Добавить" }) as HTMLButtonElement
    expect(add().disabled).toBe(true)
    fireEvent.click(screen.getByText("Дрилл 1"))
    expect(add().disabled).toBe(false)
  })

  it("attaches the picked videos then refreshes and closes", async () => {
    const { onAttached, onOpenChange } = setup()
    await screen.findByText("Дрилл 1")
    fireEvent.click(screen.getByText("Дрилл 1"))
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }))
    expect(attachMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      playlistId: "c1",
      videoIds: ["v1"],
    })
    await waitFor(() => expect(onAttached).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the all-attached empty state", async () => {
    setup({ inCourseIds: new Set(["v1", "v2"]) })
    expect(
      await screen.findByText("Все видео воркспейса уже в курсе."),
    ).toBeTruthy()
  })
})
