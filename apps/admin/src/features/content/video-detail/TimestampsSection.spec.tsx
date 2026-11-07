/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/videos", () => ({
  createVideoTimestamp: jest.fn(),
  deleteVideoTimestamp: jest.fn(),
  updateVideoTimestamp: jest.fn(),
}))

import {
  createVideoTimestamp,
  deleteVideoTimestamp,
  updateVideoTimestamp,
} from "../../../shared/api/videos"
import { TimestampsSection } from "./TimestampsSection"

const createMock = createVideoTimestamp as jest.Mock
const deleteMock = deleteVideoTimestamp as jest.Mock
const updateMock = updateVideoTimestamp as jest.Mock

const setup = (
  over: Partial<React.ComponentProps<typeof TimestampsSection>> = {},
) => {
  const onAdded = jest.fn()
  const onRemoved = jest.fn()
  const onUpdated = jest.fn()
  const onError = jest.fn()
  render(
    <TimestampsSection
      workspaceId="w1"
      videoId="v1"
      timestamps={[]}
      onAdded={onAdded}
      onRemoved={onRemoved}
      onUpdated={onUpdated}
      onError={onError}
      {...over}
    />,
  )
  return { onAdded, onRemoved, onUpdated, onError }
}

const fillAndAdd = (position: string, title: string) => {
  fireEvent.change(screen.getByPlaceholderText("0:30 / 1:23:45"), {
    target: { value: position },
  })
  fireEvent.change(screen.getByPlaceholderText("Что в этом моменте"), {
    target: { value: title },
  })
  fireEvent.click(screen.getByRole("button", { name: "+ Тайм-код" }))
}

beforeEach(() => {
  createMock.mockReset()
  deleteMock.mockReset()
  updateMock.mockReset()
})

describe("TimestampsSection", () => {
  it("renders existing timestamps as m:ss + title", () => {
    setup({ timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт", source: "manual" }] })
    expect(screen.getByText("1:30")).toBeTruthy()
    expect(screen.getByText("Маунт")).toBeTruthy()
  })

  it("parses the time and creates the timestamp", async () => {
    const created = { id: "new", positionSec: 90, title: "Гард" }
    createMock.mockResolvedValue(created)
    const { onAdded } = setup()
    fillAndAdd("1:30", "Гард")
    expect(createMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      videoId: "v1",
      positionSec: 90,
      title: "Гард",
    })
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(created))
  })

  it("rejects an unparseable time without calling the API", () => {
    const { onError } = setup()
    fillAndAdd("abc", "Гард")
    expect(onError).toHaveBeenCalledWith(
      "Не понял время. Используй MM:SS или HH:MM:SS.",
    )
    expect(createMock).not.toHaveBeenCalled()
  })

  it("rejects a position past the known duration", () => {
    const { onError } = setup({ duration: 60 })
    fillAndAdd("2:00", "Поздно")
    expect(onError).toHaveBeenCalledWith("Время за пределами видео (1:00).")
    expect(createMock).not.toHaveBeenCalled()
  })

  it("removes a timestamp via the API and reports it up", async () => {
    deleteMock.mockResolvedValue(undefined)
    const { onRemoved } = setup({
      timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт", source: "manual" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }))
    expect(deleteMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      videoId: "v1",
      timestampId: "ts1",
    })
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("ts1"))
  })

  it("badges each chapter with where it came from", () => {
    setup({
      timestamps: [
        { id: "a", positionSec: 1, title: "A", source: "manual" },
        { id: "b", positionSec: 2, title: "B", source: "ocr" },
        { id: "c", positionSec: 3, title: "C", source: "speech" },
      ],
    })
    expect(screen.getByText("Вручную")).toBeTruthy()
    expect(screen.getByText("С экрана")).toBeTruthy()
    expect(screen.getByText("Из речи")).toBeTruthy()
  })

  it("edits a chapter inline and reports the update", async () => {
    const updated = { id: "ts1", positionSec: 95, title: "Маунт, удержание", source: "manual" }
    updateMock.mockResolvedValue(updated)
    const { onUpdated } = setup({
      timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт", source: "speech" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }))
    fireEvent.change(screen.getByLabelText("Время главы"), { target: { value: "1:35" } })
    fireEvent.change(screen.getByLabelText("Название главы"), {
      target: { value: "Маунт, удержание" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(updateMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      videoId: "v1",
      timestampId: "ts1",
      data: { positionSec: 95, title: "Маунт, удержание" },
    })
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    expect(screen.queryByLabelText("Время главы")).toBeNull()
  })

  it("keeps the edit open on a bad time, and cancels without saving", () => {
    const { onError } = setup({
      timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт", source: "manual" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }))
    fireEvent.change(screen.getByLabelText("Время главы"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(onError).toHaveBeenCalledWith("Не понял время. Используй MM:SS или HH:MM:SS.")
    expect(updateMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(screen.queryByLabelText("Время главы")).toBeNull()
  })

  it("reports a failed save", async () => {
    updateMock.mockRejectedValue(new Error("boom"))
    const { onError, onUpdated } = setup({
      timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт", source: "manual" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }))
    fireEvent.keyDown(screen.getByLabelText("Название главы"), { key: "Enter" })
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onUpdated).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Время главы")).toBeTruthy()
  })
})
