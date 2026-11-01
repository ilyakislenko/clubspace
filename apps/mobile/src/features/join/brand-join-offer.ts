import type { Invitation } from "../../shared/api/invitations"
import type { JoinRequest } from "../../shared/api/join"

/**
 * Whether a branded build should offer to join its baked-in club. Signing in
 * no longer files a request on its own, so the member is asked once — unless
 * they are already in the club, already asked to join it (pending or
 * rejected), dismissed the offer before, or have a pending invitation. An
 * invitation carries no club key to match, so any open one defers the offer:
 * the member answers invitations first, and an invitation from this club is
 * itself the way in. Unknown lists (still loading, failed) never ask.
 */
export const shouldAskToJoinBrandClub = ({
  brandKey,
  workspaceKeys,
  requests,
  invitations,
  dismissed,
}: {
  brandKey: string | null
  workspaceKeys: readonly string[]
  requests: readonly JoinRequest[] | null
  invitations: readonly Invitation[] | null
  dismissed: boolean
}): boolean => {
  if (brandKey === null || dismissed) return false
  if (requests === null || invitations === null) return false
  if (workspaceKeys.includes(brandKey)) return false
  if (requests.some((r) => r.workspaceKey === brandKey)) return false
  return invitations.length === 0
}

// Per account and per club: another person signing in on this phone is asked
// on their own, and a «Не сейчас» never carries over to a different build.
export const brandJoinDismissKey = (userId: string, brandKey: string): string =>
  `clubspace.brandJoinDismissed.${userId}.${brandKey}`

export const brandJoinPrompt = (clubName: string) => ({
  title: `Вступить в клуб «${clubName}»?`,
  message:
    "Клуб получит заявку и подтвердит её. После этого здесь откроются расписание, видео и абонемент.",
  join: "Вступить",
  later: "Не сейчас",
})
