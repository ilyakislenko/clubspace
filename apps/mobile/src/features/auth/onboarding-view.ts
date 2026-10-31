import type { JoinRequest } from "../../shared/api/join"

export type OnboardingView =
  | { kind: "welcome" }
  | { kind: "requests"; pending: JoinRequest[]; rejected: JoinRequest[] }
  | { kind: "wl-pending" }
  | { kind: "wl-rejected" }
  | { kind: "wl-offer" }

// Which no-club screen to show. `whiteLabelKey` is the club baked into the
// build, or null in the club-picker build. A baked-in build reports on that
// club's request first; with none, it offers to join the club (signing in no
// longer files a request — see shouldAskToJoinBrandClub for when to offer),
// and once the offer was declined it behaves like the picker: requests the
// member made by code are listed, or the welcome screen. The picker lists
// every request.
export const onboardingView = ({
  whiteLabelKey,
  requests,
  offerBrandJoin,
}: {
  whiteLabelKey: string | null
  requests: JoinRequest[]
  offerBrandJoin: boolean
}): OnboardingView => {
  const listOrWelcome = (): OnboardingView =>
    requests.length === 0
      ? { kind: "welcome" }
      : {
          kind: "requests",
          pending: requests.filter((r) => r.status === "pending"),
          rejected: requests.filter((r) => r.status === "rejected"),
        }
  if (whiteLabelKey === null) return listOrWelcome()
  const mine = requests.filter((r) => r.workspaceKey === whiteLabelKey)
  if (mine.some((r) => r.status === "pending")) return { kind: "wl-pending" }
  if (mine.some((r) => r.status === "rejected")) return { kind: "wl-rejected" }
  return offerBrandJoin ? { kind: "wl-offer" } : listOrWelcome()
}
