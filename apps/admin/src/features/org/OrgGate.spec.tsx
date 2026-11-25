/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { getOrganization, type Organization } from "../../shared/api/organizations"
import { useOrg } from "./org-context"
import { ORG_DENIED_TEXT, OrgGate } from "./OrgGate"

jest.mock("../../shared/api/organizations", () => ({ getOrganization: jest.fn() }))
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const getMock = getOrganization as jest.MockedFunction<typeof getOrganization>

const org = (over: Partial<Organization> = {}): Organization => ({
  id: "o1",
  key: "fed",
  name: "Федерация БЖЖ",
  type: "GRAPPLING",
  city: "Томск",
  description: null,
  logoKey: null,
  logoUrl: null,
  timezone: "Asia/Tomsk",
  isDemo: true,
  myRole: "ORG_ADMIN",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
})

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })

function Probe() {
  const { org: o, isAdmin } = useOrg()
  return (
    <p>
      {o.name} · {isAdmin ? "admin" : "coach"}
    </p>
  )
}

describe("OrgGate", () => {
  beforeEach(() => getMock.mockReset())

  it("mounts the console with the federation and the caller's role", async () => {
    getMock.mockResolvedValue(org({ myRole: "ORG_COACH" }))
    render(
      <OrgGate orgId="o1">
        <Probe />
      </OrgGate>,
    )
    expect(await screen.findByText("Федерация БЖЖ · coach")).toBeTruthy()
    expect(getMock).toHaveBeenCalledWith({ organizationId: "o1" })
  })

  it.each([404, 403])("shows the team-only notice on %s and never mounts the page", async (status) => {
    getMock.mockRejectedValue(httpError(status))
    render(
      <OrgGate orgId="o1">
        <Probe />
      </OrgGate>,
    )
    expect(await screen.findByText(ORG_DENIED_TEXT)).toBeTruthy()
    expect(screen.queryByText(/Федерация БЖЖ/)).toBeNull()
  })

  it("offers a retry when the server fails", async () => {
    getMock.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(org())
    render(
      <OrgGate orgId="o1">
        <Probe />
      </OrgGate>,
    )
    fireEvent.click(await screen.findByText("Повторить"))
    expect(await screen.findByText("Федерация БЖЖ · admin")).toBeTruthy()
  })
})
