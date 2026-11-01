/// <reference lib="dom" />
import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js"

import { matchOfflineResource } from "../offline/offline-media-cache"

// Same shape as hls.js's LoadStats, built here so this module doesn't depend
// on which hls.js build (ESM or UMD) the bundler picked.
const freshStats = (): LoaderStats => ({
  aborted: false,
  loaded: 0,
  retry: 0,
  total: 0,
  chunkCount: 0,
  bwEstimate: 0,
  loading: { start: 0, first: 0, end: 0 },
  parsing: { start: 0, end: 0 },
  buffering: { start: 0, first: 0, end: 0 },
})

/**
 * hls.js loader for a downloaded lesson: the playlist, segments and keys all
 * come out of Cache Storage (features/offline/offline-media-cache.ts). It never
 * touches the network — a missing file is a load error, so an evicted download
 * can't quietly turn into streaming.
 */
export class OfflineCacheLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null
  stats: LoaderStats = freshStats()
  private aborted = false

  load(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>,
  ): void {
    this.context = context
    this.aborted = false
    this.stats = freshStats()
    const stats = this.stats
    stats.loading.start = performance.now()

    void (async () => {
      const hit = await matchOfflineResource(context.url)
      if (this.aborted) return
      if (!hit) {
        callbacks.onError({ code: 404, text: "Not stored offline" }, context, null, stats)
        return
      }
      let data: string | ArrayBuffer =
        context.responseType === "arraybuffer"
          ? await hit.arrayBuffer()
          : await hit.text()
      if (this.aborted) return
      // hls.js marks "whole file" as rangeEnd 0, like its own loaders read it.
      if (data instanceof ArrayBuffer && context.rangeEnd) {
        data = data.slice(context.rangeStart ?? 0, context.rangeEnd)
      }
      const size = typeof data === "string" ? data.length : data.byteLength
      stats.loading.first = stats.loading.end = performance.now()
      stats.loaded = stats.total = size
      callbacks.onSuccess({ url: context.url, data, code: 200 }, stats, context, null)
    })().catch((error: unknown) => {
      if (this.aborted) return
      callbacks.onError({ code: 0, text: String(error) }, context, null, stats)
    })
  }

  abort(): void {
    this.aborted = true
    this.stats.aborted = true
  }

  destroy(): void {
    this.aborted = true
    this.context = null
  }
}
