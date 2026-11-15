/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/subscriptions", () => ({
  createPlan: jest.fn(),
  getPlan: jest.fn(),
  updatePlan: jest.fn(),
}))
jest.mock("../../shared/api/payments", () => ({
  getPaymentSettings: jest.fn(),
}))

import { getPaymentSettings } from "../../shared/api/payments"
import { getPlan, updatePlan, type Plan } from "../../shared/api/subscriptions"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { PlanFormSheet } from "./PlanFormSheet"

const updateMock = updatePlan as jest.Mock
const getPlanMock = getPlan as jest.Mock
const settingsMock = getPaymentSettings as jest.Mock

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "p1",
  workspaceId: "w1",
  name: "Безлимит",
  description: null,
  price: 5000,
  currency: "RUB",
  durationDays: 30,
  classCount: null,
  isFreeTrial: false,
  startsOnFirstVisit: false,
  isActive: true,
  purchasableOnline: false,
  autopayAvailable: false,
  directions: [],
  updatedAt: "2026-11-14T10:00:00.000Z",
  ...over,
})

const staleError = () =>
  Object.assign(new Error("Request failed with status code 409"), {
    response: {
      status: 409,
      data: {
        code: "STALE_UPDATE",
        message: "Данные изменил другой пользователь. Обновите страницу — ваши правки не сохранены.",
      },
    },
  })

const props = {
  workspaceId: "w1",
  open: true,
  onOpenChange: jest.fn(),
  directions: [],
  onSaved: jest.fn(),
}

const nameInput = () => screen.getByLabelText("Название") as HTMLInputElement
const submit = () => fireEvent.submit(document.getElementById("plan-form") as HTMLFormElement)

beforeEach(() => {
  updateMock.mockReset()
  getPlanMock.mockReset()
  settingsMock.mockReset()
  // The version tests don't look at autopay: the settings never answer.
  settingsMock.mockReturnValue(new Promise(() => undefined))
  props.onOpenChange.mockReset()
  props.onSaved.mockReset()
})

describe("PlanFormSheet — someone else saved the tariff meanwhile", () => {
  it("sends the version it opened with", async () => {
    updateMock.mockResolvedValue(plan())
    render(<PlanFormSheet {...props} plan={plan()} />)
    fireEvent.change(nameInput(), { target: { value: "Безлимит+" } })
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      name: "Безлимит+",
      expectedUpdatedAt: "2026-11-14T10:00:00.000Z",
    })
  })

  it("keeps the draft and the opening version when the page passes a newer tariff", async () => {
    updateMock.mockResolvedValue(plan())
    const { rerender } = render(<PlanFormSheet {...props} plan={plan()} />)
    fireEvent.change(nameInput(), { target: { value: "Мой черновик" } })
    rerender(
      <PlanFormSheet
        {...props}
        plan={plan({ name: "Изменил коллега", updatedAt: "2026-11-14T11:00:00.000Z" })}
      />,
    )
    expect(nameInput().value).toBe("Мой черновик")
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data.expectedUpdatedAt).toBe(
      "2026-11-14T10:00:00.000Z",
    )
  })

  it("opens a newly chosen tariff after closing", () => {
    const { rerender } = render(<PlanFormSheet {...props} plan={plan()} />)
    rerender(<PlanFormSheet {...props} open={false} plan={plan()} />)
    rerender(<PlanFormSheet {...props} open plan={plan({ id: "p2", name: "Утро" })} />)
    expect(nameInput().value).toBe("Утро")
  })

  it("keeps the draft on a 409 and reloads the stored tariff on «Обновить»", async () => {
    updateMock.mockRejectedValueOnce(staleError())
    render(<PlanFormSheet {...props} plan={plan()} />)
    fireEvent.change(nameInput(), { target: { value: "Мой черновик" } })
    submit()

    await screen.findByRole("alert")
    expect(nameInput().value).toBe("Мой черновик")
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()

    const fresh = plan({ name: "Изменил коллега", updatedAt: "2026-11-14T11:00:00.000Z" })
    getPlanMock.mockResolvedValue({ plan: fresh })
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }))
    await waitFor(() => expect(nameInput().value).toBe("Изменил коллега"))
    expect(screen.queryByRole("alert")).toBeNull()

    // The next save is based on the reloaded version.
    updateMock.mockResolvedValue(fresh)
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[1][0].data.expectedUpdatedAt).toBe(
      "2026-11-14T11:00:00.000Z",
    )
  })
})

describe("PlanFormSheet — «Можно продлевать автоплатежом»", () => {
  const autopayBox = () =>
    screen.getByRole("checkbox", { name: "Можно продлевать автоплатежом" }) as HTMLInputElement
  const club = (enabled: boolean) =>
    settingsMock.mockResolvedValue({ autopayOffered: true, autopayEnabled: enabled })
  const online = plan({ purchasableOnline: true })
  const renderForm = async (p: Plan | null) => {
    render(
      <>
        <PlanFormSheet {...props} plan={p} />
        <ConfirmDialogHost />
      </>,
    )
    // Lets the settings answer before the test looks at the checkbox.
    await act(() => Promise.resolve())
  }

  it("stays hidden while the platform doesn't offer autopay", async () => {
    settingsMock.mockResolvedValue({ autopayOffered: false, autopayEnabled: false })
    await renderForm(online)
    expect(screen.queryByRole("checkbox", { name: "Можно продлевать автоплатежом" })).toBeNull()
    updateMock.mockResolvedValue(online)
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).not.toHaveProperty("autopayAvailable")
  })

  it("is disabled until the club turns autopay on, and says where", async () => {
    club(false)
    await renderForm(online)
    expect(autopayBox().disabled).toBe(true)
    expect(screen.getByText(/Включите автоплатежи в разделе/)).toBeTruthy()
  })

  it("needs online sale first", async () => {
    club(true)
    await renderForm(plan())
    expect(autopayBox().disabled).toBe(true)
    expect(screen.getByText("Сначала отметьте «Можно купить онлайн»")).toBeTruthy()
  })

  it("needs a term of a week or more to tick", async () => {
    club(true)
    await renderForm(plan({ purchasableOnline: true, durationDays: 1 }))
    expect(autopayBox().disabled).toBe(true)
    expect(screen.getByText("Автоплатёж — для тарифов сроком от 7 дней")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Дней доступа"), { target: { value: "7" } })
    expect(autopayBox().disabled).toBe(false)
  })

  it("refuses to shorten an autopay tariff below a week", async () => {
    club(true)
    await renderForm(plan({ purchasableOnline: true, autopayAvailable: true }))
    fireEvent.change(screen.getByLabelText("Дней доступа"), { target: { value: "5" } })
    expect(autopayBox().checked).toBe(true)
    submit()
    await waitFor(() => expect(screen.getAllByText("Автоплатёж — для тарифов сроком от 7 дней")).toHaveLength(2))
    expect(updateMock).not.toHaveBeenCalled()
    expect(getPlanMock).not.toHaveBeenCalled()
  })

  it("asks before a directions change ends autopay", async () => {
    club(true)
    getPlanMock.mockResolvedValue({ autopayCount: 2 })
    render(
      <>
        <PlanFormSheet
          {...props}
          directions={[{ id: "d1", name: "БЖЖ" } as never, { id: "d2", name: "ММА" } as never]}
          plan={plan({
            purchasableOnline: true,
            autopayAvailable: true,
            directions: [{ id: "d1", name: "БЖЖ" } as never],
          })}
        />
        <ConfirmDialogHost />
      </>,
    )
    await act(() => Promise.resolve())
    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: "5000" } })
    fireEvent.click(screen.getByRole("button", { name: "Весь клуб" }))
    submit()
    await screen.findByRole("dialog", { name: "Автоплатёж отключится у 2 учеников" })
  })

  it("is sent when ticked on an online tariff", async () => {
    club(true)
    await renderForm(online)
    expect(autopayBox().disabled).toBe(false)
    fireEvent.click(autopayBox())
    updateMock.mockResolvedValue(online)
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      purchasableOnline: true,
      autopayAvailable: true,
    })
    // Nobody renews a tariff that had no autopay: no count asked.
    expect(getPlanMock).not.toHaveBeenCalled()
  })

  const withAutopay = plan({ purchasableOnline: true, autopayAvailable: true })

  it("warns before a price rise reaches members on autopay", async () => {
    club(true)
    getPlanMock.mockResolvedValue({ autopayCount: 3 })
    await renderForm(withAutopay)
    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: "5500" } })
    submit()
    const dialog = await screen.findByRole("dialog", {
      name: "У 3 учеников автоплатёж по этому тарифу",
    })
    expect(dialog.textContent).toContain("Новые условия спишутся только после их подтверждения")
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0].data).toMatchObject({ price: 5500, autopayAvailable: true })
  })

  it("warns that unticking ends autopay, and saves nothing when declined", async () => {
    club(true)
    getPlanMock.mockResolvedValue({ autopayCount: 1 })
    await renderForm(withAutopay)
    fireEvent.click(autopayBox())
    submit()
    const dialog = await screen.findByRole("dialog", { name: "Автоплатёж отключится у 1 ученика" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Автоплатёж/ })).toBeNull())
    expect(updateMock).not.toHaveBeenCalled()
  })

  it.each([
    ["nobody is on autopay", "6000", 0],
    ["the price drops", "4000", 3],
  ])("asks nothing when %s", async (_, price, count) => {
    club(true)
    getPlanMock.mockResolvedValue({ autopayCount: count })
    updateMock.mockResolvedValue(withAutopay)
    await renderForm(withAutopay)
    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: price } })
    submit()
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(screen.queryByRole("dialog", { name: /автоплатёж/i })).toBeNull()
  })
})
