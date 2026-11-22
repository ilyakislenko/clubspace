/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("../../shared/api/subscriptions", () => ({
  createPlan: jest.fn(),
  getPlan: jest.fn(),
  updatePlan: jest.fn(),
}))

import { getPlan, updatePlan, type Plan } from "../../shared/api/subscriptions"
import { PlanFormSheet } from "./PlanFormSheet"

const updateMock = updatePlan as jest.Mock
const getPlanMock = getPlan as jest.Mock

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
