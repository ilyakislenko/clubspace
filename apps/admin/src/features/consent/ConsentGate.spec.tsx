/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

const replace = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))

jest.mock("../../environments/environment", () => ({
  environment: { publicAppUrl: "https://app.example.ru" },
}))

jest.mock("../../shared/api/consent", () => ({
  getMyConsent: jest.fn(),
  acceptMyConsent: jest.fn(),
}))

let consentRequiredListener: (() => void) | null = null
jest.mock("../../shared/api/client", () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
  onConsentRequired: (listener: () => void) => {
    consentRequiredListener = listener
    return () => {
      consentRequiredListener = null
    }
  },
}))

import { signOut } from "../../shared/api/client"
import { acceptMyConsent, getMyConsent } from "../../shared/api/consent"
import { ConsentGate } from "./ConsentGate"

const getMock = getMyConsent as jest.Mock
const acceptMock = acceptMyConsent as jest.Mock
const signOutMock = signOut as jest.Mock

const status = (over: Record<string, unknown> = {}) => ({
  kind: "PERSONAL_DATA",
  currentVersion: "2026-11-01",
  acceptedVersion: null,
  acceptedAt: null,
  required: true,
  ...over,
})

const apiError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  })

const setup = () =>
  render(
    <ConsentGate>
      <div>Панель клуба</div>
    </ConsentGate>,
  )

const acceptButton = () =>
  screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement

beforeEach(() => {
  getMock.mockReset()
  acceptMock.mockReset()
  signOutMock.mockClear()
  replace.mockReset()
  consentRequiredListener = null
})

describe("ConsentGate", () => {
  it("renders the dashboard straight away when consent is already given", async () => {
    getMock.mockResolvedValue(status({ required: false }))
    setup()
    expect(await screen.findByText("Панель клуба")).toBeTruthy()
  })

  it("holds the dashboard back behind the consent screen until accepted", async () => {
    getMock.mockResolvedValue(status())
    acceptMock.mockResolvedValue(status({ required: false }))
    setup()

    expect(
      await screen.findByText("Согласие на обработку персональных данных"),
    ).toBeTruthy()
    expect(screen.queryByText("Панель клуба")).toBeNull()
    expect(
      screen.getByText("Полный текст согласия").getAttribute("href"),
    ).toBe("https://app.example.ru/legal/consent")
    expect(
      screen.getByText("как удалить аккаунт").getAttribute("href"),
    ).toBe("https://app.example.ru/legal/delete-account")

    expect(acceptButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(acceptButton().disabled).toBe(false)
    fireEvent.click(acceptButton())

    expect(await screen.findByText("Панель клуба")).toBeTruthy()
    expect(acceptMock).toHaveBeenCalledWith({ version: "2026-11-01" })
  })

  it("asks again for an updated edition", async () => {
    getMock.mockResolvedValue(
      status({ currentVersion: "2027-01-15", acceptedVersion: "2026-11-01" }),
    )
    setup()
    expect(await screen.findByText(/Текст согласия обновился/)).toBeTruthy()
  })

  it("shows the new edition after a 409", async () => {
    getMock
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ currentVersion: "2027-01-15" }))
    acceptMock.mockRejectedValue(apiError(409, { code: "CONFLICT" }))
    setup()

    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(acceptButton())

    expect(
      await screen.findByText(
        "Текст согласия обновился — ознакомьтесь с новой редакцией.",
      ),
    ).toBeTruthy()
    expect(getMock).toHaveBeenCalledTimes(2)
    // A fresh edition needs a fresh tick.
    expect(acceptButton().disabled).toBe(true)
  })

  it("keeps the user on the screen with the server's message when accepting fails", async () => {
    getMock.mockResolvedValue(status())
    acceptMock.mockRejectedValue(apiError(500, { message: "Сервер недоступен" }))
    setup()

    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(acceptButton())

    expect(await screen.findByText("Сервер недоступен")).toBeTruthy()
    expect(screen.queryByText("Панель клуба")).toBeNull()
  })

  it("brings the gate back when a request answers CONSENT_REQUIRED mid-session", async () => {
    getMock
      .mockResolvedValueOnce(status({ required: false }))
      .mockResolvedValueOnce(status({ currentVersion: "2027-01-15" }))
    setup()
    await screen.findByText("Панель клуба")

    act(() => consentRequiredListener?.())

    expect(
      await screen.findByText("Согласие на обработку персональных данных"),
    ).toBeTruthy()
    expect(screen.queryByText("Панель клуба")).toBeNull()
  })

  it("offers retry and sign-out when the status can't be loaded", async () => {
    getMock
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce(status({ required: false }))
    setup()

    expect(await screen.findByText("Network Error")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }))
    expect(await screen.findByText("Панель клуба")).toBeTruthy()
  })

  it("signs out from the consent screen", async () => {
    getMock.mockResolvedValue(status())
    setup()

    fireEvent.click(await screen.findByRole("button", { name: "Выйти" }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"))
    expect(signOutMock).toHaveBeenCalled()
  })
})
