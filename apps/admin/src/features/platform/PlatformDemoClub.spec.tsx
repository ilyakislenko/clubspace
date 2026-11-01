/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import {
  fetchPlatformDemoClub,
  resetPlatformDemoClub,
  type PlatformDemoClub as DemoClub,
} from "../../shared/api/platform"
import { PlatformDemoClub } from "./PlatformDemoClub"

jest.mock("../../shared/api/platform", () => ({
  fetchPlatformDemoClub: jest.fn(),
  resetPlatformDemoClub: jest.fn(),
}))

const fetchMock = fetchPlatformDemoClub as jest.MockedFunction<typeof fetchPlatformDemoClub>
const resetMock = resetPlatformDemoClub as jest.MockedFunction<typeof resetPlatformDemoClub>

const demo = (over: Partial<DemoClub> = {}): DemoClub => ({
  enabled: true,
  workspaceKey: "academy-demo",
  loginCode: "730592",
  workspace: { id: "w1", name: "ACADEMY", joinCode: "ACADEMY7" },
  lastResetAt: null,
  accounts: [
    { email: "owner@academy.demo", name: "Артём Орлов", roleLabel: "Владелец клуба", summary: "Дашборд", via: null },
    { email: null, name: "Миша Соколов", roleLabel: "Ребёнок", summary: "Через родителя", via: "parent@academy.demo" },
  ],
  ...over,
})

describe("PlatformDemoClub", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetMock.mockReset()
  })

  it("lists the accounts with the fixed code and the join code", async () => {
    fetchMock.mockResolvedValue(demo())
    render(<PlatformDemoClub onChanged={jest.fn()} />)
    expect(await screen.findByText("owner@academy.demo")).toBeTruthy()
    expect(screen.getByText("730592")).toBeTruthy()
    expect(screen.getByText("ACADEMY7")).toBeTruthy()
    expect(screen.getByText("через parent@academy.demo → «Я / ребёнок»")).toBeTruthy()
  })

  it("explains how to switch demo mode on and disables the reset", async () => {
    fetchMock.mockResolvedValue(demo({ enabled: false, loginCode: null, workspace: null }))
    render(<PlatformDemoClub onChanged={jest.fn()} />)
    expect(await screen.findByText(/Демо-режим выключен/)).toBeTruthy()
    expect(screen.getByText("Сбросить демо").closest("button")?.disabled).toBe(true)
  })

  it("resets after a confirmation and reports what was built", async () => {
    fetchMock.mockResolvedValue(demo())
    resetMock.mockResolvedValue({
      workspaceId: "w1",
      durationMs: 2400,
      counts: { members: 133, groups: 11, sessions: 390, visits: 3200, subscriptions: 860 },
    })
    const onChanged = jest.fn()
    jest.spyOn(window, "confirm").mockReturnValue(true)
    render(<PlatformDemoClub onChanged={onChanged} />)
    await screen.findByText("owner@academy.demo")
    fireEvent.click(screen.getByText("Сбросить демо"))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(onChanged.mock.calls[0][0]).toContain("за 2.4 с")
    expect(resetMock).toHaveBeenCalledTimes(1)
  })

  it("does nothing when the confirmation is declined", async () => {
    fetchMock.mockResolvedValue(demo())
    jest.spyOn(window, "confirm").mockReturnValue(false)
    render(<PlatformDemoClub onChanged={jest.fn()} />)
    await screen.findByText("owner@academy.demo")
    fireEvent.click(screen.getByText("Сбросить демо"))
    expect(resetMock).not.toHaveBeenCalled()
  })

  it("reports a failed load", async () => {
    fetchMock.mockRejectedValue(new Error("network"))
    render(<PlatformDemoClub onChanged={jest.fn()} />)
    expect(await screen.findByText(/Не удалось загрузить демо-клуб|network/)).toBeTruthy()
  })
})
