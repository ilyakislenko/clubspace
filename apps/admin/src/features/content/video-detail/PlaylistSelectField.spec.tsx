/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { type PlaylistResponse } from "../../../shared/api/playlists"
import { PlaylistSelectField } from "./PlaylistSelectField"

const playlists: PlaylistResponse[] = [
  { id: "p1", title: "Closed Guard" },
  { id: "p2", title: "Half Guard" },
] as PlaylistResponse[]

const setup = (
  over: Partial<React.ComponentProps<typeof PlaylistSelectField>> = {},
) => {
  const onToggle = jest.fn()
  render(
    <PlaylistSelectField
      playlists={playlists}
      playlistsLoading={false}
      selectedPlaylistIds={[]}
      saving={false}
      onToggle={onToggle}
      {...over}
    />,
  )
  return { onToggle }
}

describe("PlaylistSelectField", () => {
  it("shows the placeholder when nothing is selected", () => {
    setup()
    expect(screen.getByText("Выберите плейлист")).toBeTruthy()
  })

  it("summarises the selected playlist titles on the trigger", () => {
    setup({ selectedPlaylistIds: ["p1"] })
    expect(screen.getByText("Closed Guard")).toBeTruthy()
  })

  it("reflects the saving state", () => {
    setup({ saving: true })
    expect(screen.getByText("Сохраняем...")).toBeTruthy()
  })

  it("opens the picker and toggles a playlist", () => {
    const { onToggle } = setup()
    expect(screen.queryByPlaceholderText("Введите название плейлиста")).toBeNull()
    fireEvent.click(screen.getByText("Выберите плейлист"))
    expect(
      screen.getByPlaceholderText("Введите название плейлиста"),
    ).toBeTruthy()
    fireEvent.click(screen.getByText("Half Guard"))
    expect(onToggle).toHaveBeenCalledWith("p2")
  })

  it("filters the option list by search", () => {
    setup()
    fireEvent.click(screen.getByText("Выберите плейлист"))
    fireEvent.change(
      screen.getByPlaceholderText("Введите название плейлиста"),
      { target: { value: "Half" } },
    )
    expect(screen.getByText("Half Guard")).toBeTruthy()
    expect(screen.queryByText("Closed Guard")).toBeNull()
  })
})
