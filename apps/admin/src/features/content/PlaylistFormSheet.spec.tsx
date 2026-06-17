/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/playlists", () => ({
  createPlaylist: jest.fn(),
  updatePlaylist: jest.fn(),
  createPlaylistThumbnailUpload: jest.fn(),
}))
jest.mock("../../shared/upload-to-s3", () => ({ putToPresignedUrl: jest.fn() }))

import {
  createPlaylist,
  updatePlaylist,
  type PlaylistResponse,
} from "../../shared/api/playlists"
import { PlaylistFormSheet } from "./PlaylistFormSheet"

const createMock = createPlaylist as jest.Mock
const updateMock = updatePlaylist as jest.Mock

const baseProps = {
  workspaceId: "w1",
  open: true as const,
  onOpenChange: jest.fn(),
  onSaved: jest.fn(),
}

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  baseProps.onOpenChange.mockReset()
  baseProps.onSaved.mockReset()
})

describe("PlaylistFormSheet — create", () => {
  const renderCreate = () =>
    render(<PlaylistFormSheet {...baseProps} mode="create" />)

  it("shows the create title with an editable slug", () => {
    renderCreate()
    expect(screen.getByText("Новый курс")).toBeTruthy()
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(
      false,
    )
  })

  it("keeps the submit disabled until title AND slug are filled", () => {
    renderCreate()
    const submit = () =>
      screen.getByRole("button", { name: "Создать курс" }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Closed Guard" },
    })
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "closed-guard" },
    })
    expect(submit().disabled).toBe(false)
  })

  it("creates the playlist, reports it, and closes", async () => {
    const created = { id: "p1", title: "Closed Guard" } as PlaylistResponse
    createMock.mockResolvedValue(created)
    renderCreate()
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Closed Guard" },
    })
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "closed-guard" },
    })
    fireEvent.change(screen.getByLabelText("Теги (через запятую)"), {
      target: { value: "guard, fundamentals" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Создать курс" }))
    expect(createMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      data: expect.objectContaining({
        title: "Closed Guard",
        slug: "closed-guard",
        tags: ["guard", "fundamentals"],
      }),
    })
    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalledWith(created))
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("PlaylistFormSheet — edit", () => {
  const playlist = {
    id: "p1",
    title: "Старое",
    slug: "old-slug",
    description: null,
    level: null,
    tags: [],
    thumbnailUrl: null,
  } as unknown as PlaylistResponse

  const renderEdit = () =>
    render(
      <PlaylistFormSheet {...baseProps} mode="edit" playlist={playlist} />,
    )

  it("prefills from the playlist and locks the slug", () => {
    renderEdit()
    expect(screen.getByText("Редактировать курс")).toBeTruthy()
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
      "Старое",
    )
    const slug = screen.getByLabelText("Slug") as HTMLInputElement
    expect(slug.value).toBe("old-slug")
    expect(slug.disabled).toBe(true)
  })

  it("updates the playlist, reports it, and closes", async () => {
    const updated = { id: "p1", title: "Новое" } as PlaylistResponse
    updateMock.mockResolvedValue(updated)
    renderEdit()
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Новое" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(updateMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      playlistId: "p1",
      data: expect.objectContaining({ title: "Новое" }),
    })
    await waitFor(() => expect(baseProps.onSaved).toHaveBeenCalledWith(updated))
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false)
  })
})
