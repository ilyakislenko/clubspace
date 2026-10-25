/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { ProfileEditForm } from "./ProfileEditForm"

const initial = { firstname: "Иван", lastname: "Петров", email: "ivan@mail.ru" }

const setup = (
  over: Partial<React.ComponentProps<typeof ProfileEditForm>> = {},
) => {
  const onSubmit = jest.fn().mockResolvedValue(undefined)
  const onCancel = jest.fn()
  render(
    <ProfileEditForm
      initial={initial}
      submitting={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...over}
    />,
  )
  const saveBtn = () =>
    screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement
  return { onSubmit, onCancel, saveBtn }
}

describe("ProfileEditForm", () => {
  it("renders the initial values", () => {
    setup()
    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe(
      "Иван",
    )
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "ivan@mail.ru",
    )
  })

  it("keeps Save disabled until something actually changes", () => {
    const { saveBtn } = setup()
    expect(saveBtn().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Имя"), {
      target: { value: "Иван Б" },
    })
    expect(saveBtn().disabled).toBe(false)
  })

  it("submits trimmed name + lowercased email", () => {
    const { onSubmit, saveBtn } = setup()
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  NEW@Mail.RU  " },
    })
    fireEvent.click(saveBtn())
    expect(onSubmit).toHaveBeenCalledWith({
      firstname: "Иван",
      lastname: "Петров",
      email: "new@mail.ru",
    })
  })

  it("does not submit when nothing changed (guard holds even via form submit)", () => {
    const { onSubmit, saveBtn } = setup()
    fireEvent.submit(saveBtn().closest("form")!)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("calls onCancel from the Cancel button", () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(onCancel).toHaveBeenCalled()
  })

  it("hides the phone field when the caller passes no phone", () => {
    setup()
    expect(screen.queryByLabelText("Телефон")).toBeNull()
  })

  it("submits a trimmed phone, and null when it is cleared", () => {
    const { onSubmit, saveBtn } = setup({
      initial: { ...initial, phone: "+79000000000" },
    })
    const input = screen.getByLabelText("Телефон") as HTMLInputElement
    expect(input.value).toBe("+79000000000")
    fireEvent.change(input, { target: { value: "  +7 900 111-22-33 " } })
    fireEvent.click(saveBtn())
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ phone: "+7 900 111-22-33" }),
    )
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.click(saveBtn())
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ phone: null }),
    )
  })
})
