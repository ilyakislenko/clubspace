/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { ScheduleSheet } from "./ScheduleSheet"

const setup = (over: Partial<React.ComponentProps<typeof ScheduleSheet>> = {}) => {
  const onSave = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <ScheduleSheet
      open
      onOpenChange={onOpenChange}
      publishedAt={null}
      saving={false}
      onSave={onSave}
      {...over}
    />,
  )
  return { onSave, onOpenChange }
}

describe("ScheduleSheet", () => {
  it("saves the default date with the 09:00 default time", () => {
    const { onSave } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(onSave).toHaveBeenCalledWith(expect.any(Date), "09:00")
  })

  it("clears the schedule via 'Снять расписание' (null date)", () => {
    const { onSave } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Снять расписание" }))
    expect(onSave).toHaveBeenCalledWith(null, "09:00")
  })

  it("closes on Отмена without saving", () => {
    const { onSave, onOpenChange } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("shows a saving state on the confirm button", () => {
    setup({ saving: true })
    const btn = screen.getByRole("button", {
      name: "Сохраняем...",
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
