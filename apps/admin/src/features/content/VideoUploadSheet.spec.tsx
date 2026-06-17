/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("../../shared/api/tags", () => ({ createTag: jest.fn() }))
jest.mock("../../shared/api/categories", () => ({ createCategory: jest.fn() }))
jest.mock("../../shared/api/videos", () => ({
  createVideoUpload: jest.fn(),
  completeVideoUpload: jest.fn(),
  createVideoThumbnailUpload: jest.fn(),
  deleteVideo: jest.fn(),
  getVideo: jest.fn(),
  updateVideo: jest.fn(),
}))
jest.mock("../../shared/upload-to-s3", () => ({ putToPresignedUrl: jest.fn() }))

import { createTag } from "../../shared/api/tags"
import { VideoUploadSheet } from "./VideoUploadSheet"

const createTagMock = createTag as jest.Mock

const baseProps = {
  workspaceId: "w1",
  open: true as const,
  onOpenChange: jest.fn(),
  playlists: [],
  tags: [],
  categories: [],
  tagsLoading: false,
  categoriesLoading: false,
  onTagCreated: jest.fn(),
  onCategoryCreated: jest.fn(),
}

const setup = () => render(<VideoUploadSheet {...baseProps} />)

const selectFile = () =>
  fireEvent.change(screen.getByLabelText("Файл (mp4)"), {
    target: { files: [new File(["x"], "v.mp4", { type: "video/mp4" })] },
  })

const next = () => fireEvent.click(screen.getByRole("button", { name: "Далее" }))

beforeEach(() => {
  createTagMock.mockReset()
  baseProps.onTagCreated.mockReset()
})

describe("VideoUploadSheet wizard", () => {
  it("gates step 1 'Далее' on a selected file (and Назад is disabled)", () => {
    setup()
    expect(
      (screen.getByRole("button", { name: "Назад" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    const nextBtn = () =>
      screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement
    expect(nextBtn().disabled).toBe(true)
    selectFile()
    expect(nextBtn().disabled).toBe(false)
  })

  it("advances to the details step and gates 'Далее' on a title", () => {
    setup()
    selectFile()
    next()
    const title = screen.getByLabelText("Название")
    expect(title).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.change(title, { target: { value: "Guard retention" } })
    expect(
      (screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it("steps back with 'Назад'", () => {
    setup()
    selectFile()
    next()
    fireEvent.click(screen.getByRole("button", { name: "Назад" }))
    expect(screen.getByLabelText("Файл (mp4)")).toBeTruthy()
  })

  it("creates a tag inline on the tags step", async () => {
    const created = { id: "t1", name: "Гард", type: "position" }
    createTagMock.mockResolvedValue(created)
    setup()
    selectFile()
    next() // -> details
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Guard retention" },
    })
    next() // -> tags & playlists
    fireEvent.change(screen.getByPlaceholderText("Тип (напр. position)"), {
      target: { value: "position" },
    })
    fireEvent.change(screen.getByPlaceholderText("Название тега"), {
      target: { value: "Гард" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Добавить тег" }))
    expect(createTagMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      data: expect.objectContaining({ type: "position", name: "Гард" }),
    })
    await waitFor(() =>
      expect(baseProps.onTagCreated).toHaveBeenCalledWith(created),
    )
  })
})
