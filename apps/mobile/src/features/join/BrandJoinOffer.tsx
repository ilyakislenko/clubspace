import React, { useEffect, useRef } from "react"

import { showAlert } from "../../shared/alert"
import { listMyInvitations } from "../../shared/api/invitations"
import { listMyJoinRequests } from "../../shared/api/join"
import { fetchMe } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { brandJoinPrompt, shouldAskToJoinBrandClub } from "./brand-join-offer"
import { dismissBrandJoin, isBrandJoinDismissed, useBrandJoin } from "./useBrandJoin"

/**
 * Home, branded build, member of other clubs but not of this one: asks once
 * per account whether to join the baked-in club. (Without any club the
 * onboarding screen makes the same offer inline.) Renders only the name sheet
 * the join may need.
 */
export function BrandJoinOffer() {
  const { workspaces } = useAuth()
  const { join, nameModal } = useBrandJoin()
  // The latest join without re-running the check on every render.
  const joinRef = useRef(join)
  joinRef.current = join
  // Once per mount: Home stays mounted for the session, and a different
  // account remounts the member screens.
  const asked = useRef(false)

  const brandKey = brand.workspaceKey
  const isMember = workspaces.some((w) => w.key === brandKey)

  useEffect(() => {
    if (!brandKey || isMember || asked.current) return
    asked.current = true
    void (async () => {
      try {
        const [me, requests, invitations] = await Promise.all([
          fetchMe(),
          listMyJoinRequests(),
          listMyInvitations(),
        ])
        const ask = shouldAskToJoinBrandClub({
          brandKey,
          workspaceKeys: workspaces.map((w) => w.key),
          requests: requests.data,
          invitations,
          dismissed: await isBrandJoinDismissed(me.id),
        })
        if (!ask) return
        const prompt = brandJoinPrompt(brand.displayName)
        showAlert(prompt.title, prompt.message, [
          {
            text: prompt.later,
            style: "cancel",
            onPress: () => void dismissBrandJoin(me.id),
          },
          { text: prompt.join, onPress: () => void joinRef.current() },
        ])
      } catch {
        // Offline or a failed call: try again when the club list refreshes
        // (next foregrounding).
        asked.current = false
      }
    })()
  }, [brandKey, isMember, workspaces])

  return nameModal
}
