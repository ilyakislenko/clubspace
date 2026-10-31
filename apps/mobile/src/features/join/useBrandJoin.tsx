import React, { useState } from "react"

import { showAlert } from "../../shared/alert"
import { joinWorkspaceByCode } from "../../shared/api/join"
import { fetchMe, type Me } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import { kvGet, kvSet } from "../../shared/kv"
import { EditNameModal } from "../profile/EditNameModal"
import { brandJoinDismissKey } from "./brand-join-offer"
import { joinResultView } from "./join-result"

export const isBrandJoinDismissed = async (userId: string): Promise<boolean> => {
  if (!brand.workspaceKey) return true
  const value = await kvGet(brandJoinDismissKey(userId, brand.workspaceKey)).catch(
    () => null,
  )
  return value !== null
}

export const dismissBrandJoin = async (userId: string): Promise<void> => {
  if (!brand.workspaceKey) return
  await kvSet(brandJoinDismissKey(userId, brand.workspaceKey), "1").catch(
    () => undefined,
  )
}

/**
 * Joins the club baked into this build (POST /workspaces/join with its key).
 * The server wants a name on an account that has none, so that is asked first
 * with the same name sheet as Profile. An approved (or invited) join makes the
 * club active; a request awaiting approval is reported and `onPending` lets
 * the host refresh its request list. Render `nameModal` somewhere in the tree.
 */
export function useBrandJoin(opts: { onPending?: () => void } = {}) {
  const { refresh } = useAuth()
  const { showToast } = useToast()
  const [joining, setJoining] = useState(false)
  const [nameFor, setNameFor] = useState<Me | null>(null)

  const submit = async (workspaceKey: string) => {
    setJoining(true)
    try {
      const res = await joinWorkspaceByCode({ workspaceKey })
      const view = joinResultView(res)
      if (view.action === "enter") {
        haptics.success()
        showToast(view.toast, "success")
        await refresh({ activate: res.workspaceId })
        return
      }
      showAlert(view.title, view.body)
      opts.onPending?.()
    } catch (e) {
      showAlert(
        "Не удалось отправить заявку",
        errorMessage(e, "Попробуйте ещё раз."),
      )
    } finally {
      setJoining(false)
    }
  }

  const join = async () => {
    const workspaceKey = brand.workspaceKey
    if (joining || !workspaceKey) return
    let me: Me
    try {
      me = await fetchMe()
    } catch (e) {
      showAlert(
        "Не удалось отправить заявку",
        errorMessage(e, "Попробуйте ещё раз."),
      )
      return
    }
    if (!me.firstname?.trim()) {
      setNameFor(me)
      return
    }
    await submit(workspaceKey)
  }

  const nameModal = nameFor ? (
    <EditNameModal
      me={nameFor}
      onClose={() => setNameFor(null)}
      onSaved={(updated) => {
        setNameFor(null)
        // The club sees this name in the request; without one the server
        // refuses, so only go on once a name is there.
        if (updated.firstname?.trim() && brand.workspaceKey) {
          void submit(brand.workspaceKey)
        }
      }}
    />
  ) : null

  return { join, joining, nameModal }
}
