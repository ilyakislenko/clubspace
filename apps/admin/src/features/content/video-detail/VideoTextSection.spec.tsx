/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/videos", () => ({
  getVideoTextStatus: jest.fn(),
  regenerateVideoText: jest.fn(),
}))

import {
  getVideoTextStatus,
  regenerateVideoText,
  type VideoTextStatus,
} from "../../../shared/api/videos"
import { REGENERATION_POLL_MS, VideoTextSection } from "./VideoTextSection"

const statusMock = getVideoTextStatus as jest.Mock
const regenerateMock = regenerateVideoText as jest.Mock

const STATUS: VideoTextStatus = {
  videoStatus: "ready",
  chaptersScannedAt: "2026-05-01T10:00:00.000Z",
  transcript: {
    language: "en",
    segmentCount: 12,
    translatedRu: true,
    updatedAt: "2026-05-01T09:00:00.000Z",
  },
  chapters: { manual: 0, auto: 3 },
  subtitles: { manual: 1, auto: 2 },
  regeneration: null,
}

const setup = () => {
  const onChanged = jest.fn()
  const onError = jest.fn()
  render(
    <VideoTextSection workspaceId="w1" videoId="v1" onChanged={onChanged} onError={onError} />,
  )
  return { onChanged, onError }
}

beforeEach(() => {
  statusMock.mockReset()
  regenerateMock.mockReset()
  window.confirm = jest.fn(() => true)
})

afterEach(() => jest.useRealTimers())

describe("VideoTextSection", () => {
  it("shows the transcript and the chapter and subtitle sources", async () => {
    statusMock.mockResolvedValue(STATUS)
    setup()
    await screen.findByText("Расшифровка: en, 12 фраз, перевод на русский есть.")
    expect(screen.getByText("Главы: 0 вручную, 3 автоматических.")).toBeTruthy()
    expect(screen.getByText("Субтитры: 1 загружено, 2 автоматических.")).toBeTruthy()
    expect(statusMock).toHaveBeenCalledWith({ workspaceId: "w1", videoId: "v1" })
  })

  it("regenerates, then reloads the chapters when the worker is done", async () => {
    jest.useFakeTimers()
    statusMock
      .mockResolvedValueOnce(STATUS)
      .mockResolvedValueOnce({ ...STATUS, regeneration: "active" })
      .mockResolvedValueOnce(STATUS)
    regenerateMock.mockResolvedValue({ status: "queued", chaptersRemoved: 3, subtitlesRemoved: 0 })
    const { onChanged } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Пересоздать главы" }))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() =>
      expect(regenerateMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        videoId: "v1",
        data: { chapters: true, subtitles: false },
      }),
    )
    // The automatic rows were removed: reload at once.
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole("status")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Пересоздать субтитры" }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(REGENERATION_POLL_MS)
    })
    expect(await screen.findByText("Пересоздаём главы и субтитры…")).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(REGENERATION_POLL_MS)
    })
    // Finished: the new chapters/subtitles are loaded.
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("does nothing when the confirmation is declined", async () => {
    statusMock.mockResolvedValue(STATUS)
    window.confirm = jest.fn(() => false)
    setup()
    fireEvent.click(await screen.findByRole("button", { name: "Пересоздать субтитры" }))
    expect(regenerateMock).not.toHaveBeenCalled()
  })

  it("keeps chapters off while there are manual ones, and reports errors", async () => {
    statusMock.mockResolvedValue({ ...STATUS, chapters: { manual: 2, auto: 0 } })
    regenerateMock.mockRejectedValue(new Error("busy"))
    const { onError, onChanged } = setup()
    const chapters = (await screen.findByRole("button", {
      name: "Пересоздать главы",
    })) as HTMLButtonElement
    expect(chapters.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Пересоздать субтитры" }))
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("reports a status that can't be loaded", async () => {
    statusMock.mockRejectedValue(new Error("down"))
    const { onError } = setup()
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(screen.getByText("Загружаем расшифровку…")).toBeTruthy()
  })
})
