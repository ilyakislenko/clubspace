import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"

import { TrialRequestForm } from "../src/features/public-club/TrialRequestForm"
import { createPublicTrialRequest } from "../src/shared/api/public-trial"

jest.mock("../src/shared/api/public-trial", () => ({
  createPublicTrialRequest: jest.fn(),
}))

const send = createPublicTrialRequest as jest.MockedFunction<
  typeof createPublicTrialRequest
>

const FORM = {
  clubName: "Академия",
  directions: [
    { id: "d-1", name: "Дети 6–9" },
    { id: "d-2", name: "Взрослые" },
  ],
  operator: { name: "ИП Орлов Артём Сергеевич", address: "г. Москва, ул. Примерная, 1" },
  contacts: [{ label: "Администратор", phone: "+79528849420" }],
}

const renderForm = (source: "page" | "qr" = "page") =>
  render(
    <TrialRequestForm
      slug="academy"
      form={FORM}
      consentVersion="2026-12-01"
      source={source}
    />,
  )

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const fillAdult = () => {
  type("Как вас зовут", "Анна")
  type("Телефон", "8 952 884-94-20")
}

const consentBox = () =>
  screen.getByRole("checkbox", { name: /Я даю согласие/ }) as HTMLInputElement

const submit = () =>
  screen.getByRole("button", { name: "Отправить заявку" }) as HTMLButtonElement

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ status: "received" })
})

describe("TrialRequestForm", () => {
  it("starts with the consent unticked, naming the club operator, and sends nothing without it", () => {
    renderForm()
    fillAdult()
    expect(consentBox().checked).toBe(false)
    expect(consentBox().closest("label")?.textContent).toContain(
      "Я даю согласие ИП Орлов Артём Сергеевич на обработку моих персональных данных на условиях согласия",
    )
    expect(screen.getByRole("link", { name: "согласия" }).getAttribute("href")).toBe(
      "/c/academy/trial/consent",
    )
    expect(submit().disabled).toBe(true)
    fireEvent.submit(submit().closest("form") as HTMLFormElement)
    expect(send).not.toHaveBeenCalled()
  })

  it("sends a page request with the consent version once the box is ticked, then shows the club contacts", async () => {
    renderForm()
    fillAdult()
    type(/E-mail/, "anna@example.com")
    fireEvent.change(screen.getByLabelText("Направление"), { target: { value: "d-2" } })
    type("Комментарий", "Вечером удобнее")
    fireEvent.click(consentBox())
    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())

    await screen.findByText("Заявка отправлена")
    expect(send).toHaveBeenCalledWith("academy", {
      name: "Анна",
      phone: "8 952 884-94-20",
      email: "anna@example.com",
      forChild: false,
      childName: undefined,
      childAge: undefined,
      directionId: "d-2",
      comment: "Вечером удобнее",
      source: "page",
      consent: true,
      consentVersion: "2026-12-01",
      website: undefined,
    })
    expect(screen.getByText("«Академия» свяжется с вами по телефону.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "+79528849420" }).getAttribute("href")).toBe(
      "tel:+79528849420",
    )
  })

  it("«Заявка для ребёнка» reveals the child's name and age and extends the consent to the child", async () => {
    renderForm()
    expect(screen.queryByLabelText("Имя ребёнка")).toBeNull()
    fireEvent.click(screen.getByRole("checkbox", { name: "Заявка для ребёнка" }))
    expect(consentBox().closest("label")?.textContent).toContain(
      "и данных ребёнка, законным представителем которого я являюсь",
    )
    fillAdult()
    type("Имя ребёнка", "Маша")
    type("Возраст", "8")
    fireEvent.click(consentBox())
    fireEvent.click(submit())

    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0][1]).toMatchObject({
      forChild: true,
      childName: "Маша",
      childAge: 8,
      directionId: undefined,
    })
  })

  it("a QR visit is sent as source qr", async () => {
    renderForm("qr")
    fillAdult()
    fireEvent.click(consentBox())
    fireEvent.click(submit())
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0][1].source).toBe("qr")
  })

  it("passes the honeypot through for the server to drop", async () => {
    const { container } = renderForm()
    fillAdult()
    const trap = container.querySelector('input[name="website"]') as HTMLInputElement
    expect(trap.tabIndex).toBe(-1)
    expect(trap.getAttribute("autocomplete")).toBe("off")
    fireEvent.change(trap, { target: { value: "http://spam.example" } })
    fireEvent.click(consentBox())
    fireEvent.click(submit())
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0][1].website).toBe("http://spam.example")
  })

  it("shows the server's refusal and keeps the form", async () => {
    send.mockRejectedValue({
      response: { status: 400, data: { message: "Проверьте номер телефона" } },
    })
    renderForm()
    fillAdult()
    fireEvent.click(consentBox())
    fireEvent.click(submit())
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Проверьте номер телефона",
    )
    expect((screen.getByLabelText("Как вас зовут") as HTMLInputElement).value).toBe("Анна")
    expect(submit().disabled).toBe(false)
  })

  it("leaves the direction out when the club has none", () => {
    render(
      <TrialRequestForm
        slug="academy"
        form={{ ...FORM, directions: [] }}
        consentVersion="2026-12-01"
        source="page"
      />,
    )
    expect(screen.queryByLabelText("Направление")).toBeNull()
  })
})
