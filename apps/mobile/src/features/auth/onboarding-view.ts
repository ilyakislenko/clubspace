import type { JoinRequest } from "../../shared/api/join"

export type OnboardingView =
  | { kind: "welcome" }
  | { kind: "requests"; pending: JoinRequest[]; rejected: JoinRequest[] }
  | { kind: "wl-pending" }
  | { kind: "wl-rejected" }
  | { kind: "wl-missing" }

// Which no-club screen to show. `whiteLabelKey` is the club baked into the
// build, or null in the club-picker build. A baked-in build reports on that
// club's request first; with none, requests the member made by code to other
// clubs are listed, and with none at all the key matched nothing — never a
// silent «sent». The picker lists every request.
export const onboardingView = ({
  whiteLabelKey,
  requests,
}: {
  whiteLabelKey: string | null
  requests: JoinRequest[]
}): OnboardingView => {
  const list = (): OnboardingView => ({
    kind: "requests",
    pending: requests.filter((r) => r.status === "pending"),
    rejected: requests.filter((r) => r.status === "rejected"),
  })
  if (whiteLabelKey === null) {
    return requests.length === 0 ? { kind: "welcome" } : list()
  }
  const mine = requests.filter((r) => r.workspaceKey === whiteLabelKey)
  if (mine.some((r) => r.status === "pending")) return { kind: "wl-pending" }
  if (mine.some((r) => r.status === "rejected")) return { kind: "wl-rejected" }
  return requests.length > 0 ? list() : { kind: "wl-missing" }
}
