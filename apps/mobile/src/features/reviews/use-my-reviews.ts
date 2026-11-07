import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  MyReviews,
  ReviewCard,
  ReviewGrade,
} from "../../shared/api/bookmark-reviews"
import {
  type CachedResource,
  useCachedResource,
} from "../../shared/cache/useCachedResource"
import { applyLocalGrades, type LocalGrades } from "./review-helpers"
import {
  fetchMyReviews,
  gradeCard,
  readLocalGrades,
  reviewsCacheKey,
} from "./review-store"

export type MyReviewsState = {
  resource: CachedResource<MyReviews>
  /** The due list minus cards graded on this device (null until loaded). */
  view: MyReviews | null
  grade: (card: ReviewCard, grade: ReviewGrade, reviewedAt: Date) => Promise<void>
}

/** The member's «Повторение» due list (cached, works offline). `null` = off. */
export function useMyReviews(workspaceId: string | null): MyReviewsState {
  const resource = useCachedResource(
    workspaceId ? reviewsCacheKey(workspaceId) : null,
    useCallback(async () => await fetchMyReviews(workspaceId!), [workspaceId]),
  )
  const [grades, setGrades] = useState<LocalGrades>({})

  // On every visit and after every fetch (a fetch prunes them).
  const reloadGrades = useCallback(() => {
    if (workspaceId) void readLocalGrades(workspaceId).then(setGrades)
  }, [workspaceId])
  useFocusEffect(reloadGrades)
  useEffect(reloadGrades, [reloadGrades, resource.data])

  const view = useMemo(
    () => (resource.data ? applyLocalGrades(resource.data, grades) : null),
    [resource.data, grades],
  )

  const grade = useCallback(
    async (card: ReviewCard, value: ReviewGrade, reviewedAt: Date) => {
      if (!workspaceId) return
      setGrades(await gradeCard(workspaceId, card, value, reviewedAt))
    },
    [workspaceId],
  )

  return { resource, view, grade }
}
