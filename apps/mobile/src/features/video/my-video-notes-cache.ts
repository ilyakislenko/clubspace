import type { MyVideoNotesItem } from "../../shared/api/video-study"
import { readResource } from "../../shared/cache/resource-cache"
import { readLocalStudy } from "../profile/preferences-store"
import { filterVideoNotes, overlayLocalStudy } from "../profile/study-merge"

// «Мои заметки» offline: the last unfiltered list, per club (and per profile —
// the resource cache is).
export const myVideoNotesCacheKey = (workspaceId: string) =>
  `my-video-notes:${workspaceId}`

/**
 * The cached list with this device's newer (possibly unsynced) edits laid over
 * it, searched for `query`; null when nothing was ever cached.
 */
export const readCachedVideoNotes = async (
  workspaceId: string,
  query: string,
): Promise<MyVideoNotesItem[] | null> => {
  const [cached, local] = await Promise.all([
    readResource<MyVideoNotesItem[]>(myVideoNotesCacheKey(workspaceId)),
    readLocalStudy(),
  ])
  if (!cached) return null
  return filterVideoNotes(
    overlayLocalStudy(cached.data, local.bookmarks, local.notes),
    query,
  )
}
