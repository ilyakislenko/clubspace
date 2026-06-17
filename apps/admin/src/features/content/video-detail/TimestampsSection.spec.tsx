/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/videos", () => ({
  createVideoTimestamp: jest.fn(),
  deleteVideoTimestamp: jest.fn(),
}))

import {
  createVideoTimestamp,
  deleteVideoTimestamp,
} from "../../../shared/api/videos"
import { TimestampsSection } from "./TimestampsSection"

const createMock = createVideoTimestamp as jest.Mock
const deleteMock = deleteVideoTimestamp as jest.Mock

const setup = (
  over: Partial<React.ComponentProps<typeof TimestampsSection>> = {},
) => {
  const onAdded = jest.fn()
  const onRemoved = jest.fn()
  const onError = jest.fn()
  render(
    <TimestampsSection
      workspaceId="w1"
      videoId="v1"
      timestamps={[]}
      onAdded={onAdded}
      onRemoved={onRemoved}
      onError={onError}
      {...over}
    />,
  )
  return { onAdded, onRemoved, onError }
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
})

describe("TimestampsSection", () => {
  it("renders existing timestamps as m:ss + title", () => {
    setup({ timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт" }] })
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
      timestamps: [{ id: "ts1", positionSec: 90, title: "Маунт" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }))
    expect(deleteMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      videoId: "v1",
      timestampId: "ts1",
    })
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("ts1"))
  })
})
