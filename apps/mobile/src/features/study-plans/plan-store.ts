import {
  getMyStudyPlan,
  type StudyPlan,
} from "../../shared/api/study-plans"
import { invalidateResource } from "../../shared/cache/cache-events"
import { readResource, writeResource } from "../../shared/cache/resource-cache"
import { errorMessage } from "../../shared/error-message"

// «Мои планы» offline: the list and every opened plan are cached resources
// (per profile, wiped on sign-out), so plans can be viewed and played without
// network. Editing needs the server — no outbox.

const RESOURCE = "study-plans"
export const plansCacheKey = (workspaceId: string) => `${RESOURCE}:${workspaceId}`
export const planCacheKey = (workspaceId: string, planId: string) =>
  `${RESOURCE}:${workspaceId}:${planId}`

/** The plan from the server (cached on the way), or the cached copy offline. */
export const loadStudyPlan = async (
  workspaceId: string,
  planId: string,
): Promise<StudyPlan> => {
  try {
    const fresh = await getMyStudyPlan({ workspaceId, planId })
    await writeResource(planCacheKey(workspaceId, planId), fresh)
    return fresh
  } catch (err) {
    const cached = await readResource<StudyPlan>(planCacheKey(workspaceId, planId))
    if (cached) return cached.data
    throw err
  }
}

/**
 * After an edit: keep the server's answer for offline use and refresh every
 * open plan screen and the list (counts, covers, order).
 */
export const planChanged = async (workspaceId: string, plan?: StudyPlan) => {
  if (plan) await writeResource(planCacheKey(workspaceId, plan.id), plan)
  invalidateResource(RESOURCE, workspaceId)
}

const NETWORK_CODES = new Set(["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"])

/** An edit's error for a toast, with a plain «no network» when offline. */
export const planEditErrorMessage = (err: unknown, fallback: string): string => {
  if (
    typeof err === "object" &&
    err !== null &&
    !("response" in err && err.response) &&
    "code" in err &&
    typeof err.code === "string" &&
    NETWORK_CODES.has(err.code)
  ) {
    return "Нет сети — планы можно менять только онлайн."
  }
  return errorMessage(err, fallback)
}
