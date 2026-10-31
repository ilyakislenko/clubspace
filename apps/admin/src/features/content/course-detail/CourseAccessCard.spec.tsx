/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../../shared/api/playlists", () => ({
  getCourseAudience: jest.fn(),
  updateCourseAudience: jest.fn(),
  updatePlaylist: jest.fn(),
}))

import {
  getCourseAudience,
  updateCourseAudience,
  updatePlaylist,
} from "../../../shared/api/playlists"
import { CourseAccessCard } from "./CourseAccessCard"

const getMock = getCourseAudience as jest.Mock
const putMock = updateCourseAudience as jest.Mock
const patchMock = updatePlaylist as jest.Mock

const audience = (over: Record<string, unknown> = {}) => ({
  courseId: "c1",
  groupIds: [],
  rankLevelIds: [],
  planIds: [],
  orphaned: { groups: 0, rankLevels: 0, plans: 0 },
  summary: null,
  options: {
    groups: [
      { id: "g1", name: "Дети" },
      { id: "g2", name: "Взрослые" },
    ],
    ladders: [
      {
        id: "lad",
        name: "Взрослые пояса",
        isActive: true,
        levels: [
          { id: "white", name: "Белый пояс", order: 0, color: null, isActive: true },
          { id: "blue", name: "Синий пояс", order: 1, color: null, isActive: true },
        ],
      },
    ],
    plans: [
      { id: "p1", name: "Безлимит", isActive: true },
      { id: "old", name: "Архивный", isActive: false },
    ],
  },
  ...over,
})

const setup = (lockedProgression = false) => {
  const onProgressionSaved = jest.fn()
  render(
    <CourseAccessCard
      workspaceId="w1"
      courseId="c1"
      lockedProgression={lockedProgression}
      onProgressionSaved={onProgressionSaved}
    />,
  )
  return { onProgressionSaved }
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(audience())
  putMock.mockReset()
  patchMock.mockReset()
})

describe("CourseAccessCard", () => {
  it("shows an open course as «Весь клуб» and hides retired plans", async () => {
    setup()
    expect(await screen.findByText("Весь клуб")).toBeTruthy()
    expect(getMock).toHaveBeenCalledWith({ workspaceId: "w1", playlistId: "c1" })
    expect(screen.getByText("Безлимит")).toBeTruthy()
    expect(screen.queryByText("Архивный")).toBeNull()
  })

  it("saves picked groups, the minimum level and plans", async () => {
    putMock.mockResolvedValue(
      audience({
        groupIds: ["g1"],
        rankLevelIds: ["blue"],
        planIds: ["p1"],
        summary: "Для группы «Дети» · Доступно с уровня «Синий пояс»",
      }),
    )
    setup()
    fireEvent.click(await screen.findByText("Дети"))
    fireEvent.change(
      screen.getByLabelText("Минимальный уровень: Взрослые пояса"),
      { target: { value: "blue" } },
    )
    fireEvent.click(screen.getByText("Безлимит"))
    fireEvent.click(screen.getByText("Сохранить доступ"))

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith({
        workspaceId: "w1",
        playlistId: "c1",
        data: { groupIds: ["g1"], rankLevelIds: ["blue"], planIds: ["p1"] },
      }),
    )
    expect(
      await screen.findByText("Для группы «Дети» · Доступно с уровня «Синий пояс»"),
    ).toBeTruthy()
  })

  it("unpicks a selected group", async () => {
    getMock.mockResolvedValue(audience({ groupIds: ["g1"] }))
    putMock.mockResolvedValue(audience())
    setup()
    const chip = await screen.findByText("Дети")
    expect(chip.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(chip)
    fireEvent.click(screen.getByText("Сохранить доступ"))
    await waitFor(() =>
      expect(putMock.mock.calls[0][0].data.groupIds).toEqual([]),
    )
  })

  it("warns about restrictions left by deleted targets", async () => {
    getMock.mockResolvedValue(
      audience({ orphaned: { groups: 1, rankLevels: 0, plans: 0 } }),
    )
    setup()
    expect(
      await screen.findByText(/ссылается на удалённые группы/),
    ).toBeTruthy()
  })

  it("toggles locked progression through the course PATCH", async () => {
    patchMock.mockResolvedValue({ lockedProgression: true })
    const { onProgressionSaved } = setup(false)
    const toggle = await screen.findByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(toggle)
    await waitFor(() => expect(onProgressionSaved).toHaveBeenCalledWith(true))
    expect(patchMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      playlistId: "c1",
      data: { lockedProgression: true },
    })
  })

  it("shows the server error when saving fails", async () => {
    putMock.mockRejectedValue(new Error("boom"))
    setup()
    fireEvent.click(await screen.findByText("Сохранить доступ"))
    expect(await screen.findByText(/boom|Не удалось сохранить доступ/)).toBeTruthy()
  })

  it("shows a load error", async () => {
    getMock.mockRejectedValue(new Error("down"))
    setup()
    expect(
      await screen.findByText(/down|Не удалось загрузить настройки доступа/),
    ).toBeTruthy()
  })
})
