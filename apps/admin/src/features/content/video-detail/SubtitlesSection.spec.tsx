/** @jest-environment jsdom */
import { fireEvent, render, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/videos", () => ({
  createSubtitleUpload: jest.fn(),
  createSubtitle: jest.fn(),
  deleteSubtitle: jest.fn(),
}))

import {
  createSubtitle,
  createSubtitleUpload,
  deleteSubtitle,
} from "../../../shared/api/videos"
import { SubtitlesSection } from "./SubtitlesSection"

const uploadMock = createSubtitleUpload as jest.Mock
const createMock = createSubtitle as jest.Mock
const deleteMock = deleteSubtitle as jest.Mock

type Subs = React.ComponentProps<typeof SubtitlesSection>["subtitles"]

const setup = (subtitles: Subs = []) => {
  const onUploaded = jest.fn()
  const onRemoved = jest.fn()
  const onError = jest.fn()
  const utils = render(
    <SubtitlesSection
      workspaceId="w1"
      videoId="v1"
      subtitles={subtitles}
      onUploaded={onUploaded}
      onRemoved={onRemoved}
      onError={onError}
    />,
  )
  const fileInput = utils.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement
  return { ...utils, fileInput, onUploaded, onRemoved, onError }
}

beforeEach(() => {
  uploadMock.mockReset()
  createMock.mockReset()
  deleteMock.mockReset()
  ;(global.fetch as unknown) = jest.fn().mockResolvedValue({ ok: true })
})

describe("SubtitlesSection", () => {
  it("renders an existing track with a safe file link", () => {
    const { getByText } = setup([
      { id: "s1", language: "ru", label: "Русские", publicUrl: "https://cdn/s.vtt" },
    ] as Subs)
    expect(getByText("Русские")).toBeTruthy()
    const link = getByText("Файл") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("https://cdn/s.vtt")
  })

  it("rejects a non-vtt/srt file without hitting the API", () => {
    const { fileInput, onError } = setup()
    const file = new File(["x"], "notes.txt", { type: "text/plain" })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(onError).toHaveBeenCalledWith("Поддерживаются файлы .vtt и .srt.")
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it("uploads a .vtt file: presign -> PUT -> create -> onUploaded", async () => {
    uploadMock.mockResolvedValue({
      upload: { url: "https://s3/put", method: "PUT" },
      key: "k1",
      publicUrl: "https://cdn/s.vtt",
    })
    const created = {
      id: "new",
      language: "ru",
      label: "RU",
      publicUrl: "https://cdn/s.vtt",
    }
    createMock.mockResolvedValue(created)
    const { fileInput, onUploaded } = setup()
    const file = new File(["WEBVTT"], "subs.vtt", { type: "text/vtt" })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(created))
    expect(global.fetch).toHaveBeenCalledWith(
      "https://s3/put",
      expect.objectContaining({ method: "PUT" }),
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "w1",
        videoId: "v1",
        data: expect.objectContaining({ storageKey: "k1", language: "ru" }),
      }),
    )
  })

  it("removes a track via the API and reports it up", async () => {
    deleteMock.mockResolvedValue(undefined)
    const { getByRole, onRemoved } = setup([
      { id: "s1", language: "ru", label: "Русские", publicUrl: "https://cdn/s.vtt" },
    ] as Subs)
    fireEvent.click(getByRole("button", { name: "Удалить" }))
    expect(deleteMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      videoId: "v1",
      subtitleId: "s1",
    })
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("s1"))
  })
})
