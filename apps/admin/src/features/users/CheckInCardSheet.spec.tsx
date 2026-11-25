/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/check-in-card", () => ({
  getMemberCheckInCard: jest.fn(),
}))
jest.mock("./check-in-card-print", () => ({
  openCheckInCardPrint: jest.fn(() => true),
}))

import { getMemberCheckInCard } from "../../shared/api/check-in-card"
import { CheckInCardSheet } from "./CheckInCardSheet"
import { openCheckInCardPrint } from "./check-in-card-print"

const getMock = getMemberCheckInCard as jest.Mock
const printMock = openCheckInCardPrint as jest.Mock

const card = {
  card: "CS1.11111111-2222-4333-8444-555555555555.AbCdEfGh_-123456",
  qrPngDataUrl: "data:image/png;base64,QR",
  name: "Аня Смирнова",
}

beforeEach(() => {
  getMock.mockReset()
  printMock.mockClear()
})

const renderSheet = (open = true) =>
  render(
    <CheckInCardSheet open={open} onOpenChange={() => undefined} workspaceId="w1" userId="u1" />,
  )

describe("CheckInCardSheet", () => {
  it("reads nothing while closed", () => {
    renderSheet(false)
    expect(getMock).not.toHaveBeenCalled()
  })

  it("shows the member's QR, name and the hint, and prints that card", async () => {
    getMock.mockResolvedValue(card)
    renderSheet()
    expect(getMock).toHaveBeenCalledWith({ workspaceId: "w1", userId: "u1" })
    const img = (await screen.findByAltText("QR-код карты: Аня Смирнова")) as HTMLImageElement
    expect(img.getAttribute("src")).toBe("data:image/png;base64,QR")
    expect(screen.getByText("Аня Смирнова")).toBeTruthy()
    const hint = screen.getByText(/^Покажите эту карту .+ у входа$/).textContent
    fireEvent.click(screen.getByRole("button", { name: "Распечатать" }))
    expect(printMock).toHaveBeenCalledWith({
      name: "Аня Смирнова",
      qrPngDataUrl: "data:image/png;base64,QR",
      hint,
    })
  })

  it("keeps «Распечатать» off and says why when the card can't be read", async () => {
    getMock.mockRejectedValue(
      Object.assign(new Error("x"), {
        isAxiosError: true,
        response: { status: 403, data: { message: "Недостаточно прав" } },
      }),
    )
    renderSheet()
    await waitFor(() => expect(screen.getByText(/Недостаточно прав|Не удалось загрузить карту/)).toBeTruthy())
    expect((screen.getByRole("button", { name: "Распечатать" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("says so when the browser blocks the print window", async () => {
    getMock.mockResolvedValue(card)
    printMock.mockReturnValueOnce(false)
    renderSheet()
    await screen.findByAltText("QR-код карты: Аня Смирнова")
    fireEvent.click(screen.getByRole("button", { name: "Распечатать" }))
    expect(await screen.findByText(/разрешите всплывающие окна/)).toBeTruthy()
  })
})
