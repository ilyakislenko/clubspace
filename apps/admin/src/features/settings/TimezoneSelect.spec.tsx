/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { TimezoneSelect } from "./TimezoneSelect"

describe("TimezoneSelect", () => {
  it("shows the zone by city and picks another one found by search", () => {
    const onChange = jest.fn()
    render(<TimezoneSelect value="Europe/Moscow" onChange={onChange} />)
    const trigger = screen.getByRole("combobox")
    expect(trigger.textContent).toContain("Москва (UTC+3)")

    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText("Поиск часового пояса"), {
      target: { value: "томск" },
    })
    fireEvent.click(screen.getByRole("option", { name: "Томск (UTC+7)" }))
    expect(onChange).toHaveBeenCalledWith("Asia/Tomsk")
  })

  it("takes an exact IANA name that is not on the list", () => {
    const onChange = jest.fn()
    render(<TimezoneSelect value="Europe/Moscow" onChange={onChange} />)
    fireEvent.click(screen.getByRole("combobox"))
    const search = screen.getByLabelText("Поиск часового пояса")
    fireEvent.change(search, { target: { value: "Europe/Minsk" } })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("Europe/Minsk")
  })
})
