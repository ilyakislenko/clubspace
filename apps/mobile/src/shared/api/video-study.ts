import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// The member's own study data for a lesson: bookmarks (a moment or an A–B
// segment, each with a label and a note) and one free-text note. The device
// keeps the working copy (preferences-store) and syncs it through these;
// writes are last-write-wins on the client's `updatedAt`.

export type MyVideoBookmark =
  ApiTypes.ListMyVideoBookmarksOutputOutput["items"][number]
export type MyVideoNote = ApiTypes.GetMyVideoNoteOutputOutput
export type MyVideoNotesItem =
  ApiTypes.ListMyVideoNotesOutputOutput["items"][number]

export const listMyVideoBookmarks = async (params: { videoId: string }) => {
  return await getApiClient().request<ApiTypes.ListMyVideoBookmarksOutputOutput>(
    {
      method: "get",
      url: `/videos/${params.videoId}/my-bookmarks`,
    },
  )
}

// Upsert by the client-generated id; `deleted: true` removes (the server keeps
// a tombstone). A newer row on the server wins and comes back unchanged — it
// may itself be a tombstone.
export const putMyVideoBookmark = async (params: {
  videoId: string
  bookmarkId: string
  data: ApiTypes.PutMyVideoBookmarkInput
}) => {
  return await getApiClient().request<
    ApiTypes.PutMyVideoBookmarkOutputOutput,
    ApiTypes.PutMyVideoBookmarkInput
  >({
    method: "put",
    url: `/videos/${params.videoId}/my-bookmarks/${params.bookmarkId}`,
    data: params.data,
  })
}

export const getMyVideoNote = async (params: { videoId: string }) => {
  return await getApiClient().request<ApiTypes.GetMyVideoNoteOutputOutput>({
    method: "get",
    url: `/videos/${params.videoId}/my-note`,
  })
}

// Empty text clears the note (stored, with its `updatedAt`, so clears order
// like edits). A newer note on the server wins and comes back.
export const putMyVideoNote = async (params: {
  videoId: string
  data: ApiTypes.PutMyVideoNoteInput
}) => {
  return await getApiClient().request<
    ApiTypes.PutMyVideoNoteOutputOutput,
    ApiTypes.PutMyVideoNoteInput
  >({
    method: "put",
    url: `/videos/${params.videoId}/my-note`,
    data: params.data,
  })
}

// Every lesson of the club the member has a note or bookmarks on, newest
// activity first; `q` searches titles, notes and bookmark labels/notes.
export const listMyVideoNotes = async (params: {
  workspaceId: string
  q?: string
}) => {
  const q = params.q?.trim()
  return await getApiClient().request<ApiTypes.ListMyVideoNotesOutputOutput>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/video-notes`,
    params: q ? { q } : undefined,
  })
}
