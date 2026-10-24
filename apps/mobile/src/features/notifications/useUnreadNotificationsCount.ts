import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useState } from "react"

import { listNotifications } from "../../shared/api/notifications"
import { countUnread } from "./unread"

// Refreshed whenever the screen comes into focus (e.g. after the inbox marked
// everything seen) — not live; a push or realtime event doesn't touch it.
export const useUnreadNotificationsCount = (): number => {
  const [count, setCount] = useState(0)
  useFocusEffect(
    useCallback(() => {
      void listNotifications({ perPage: 50 })
        .then((page) => setCount(countUnread(page.data)))
        .catch(() => undefined)
    }, []),
  )
  return count
}
