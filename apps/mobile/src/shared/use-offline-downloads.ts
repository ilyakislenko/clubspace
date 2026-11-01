import { useAuth } from "./auth-context"
import { supportsOfflineDownload } from "./platform"

/**
 * Whether to offer offline downloads: native, or a browser that can store and
 * play them (see platform), and never in
 * a child's profile — downloads are the guardian's, kept on the device as
 * theirs.
 */
export const useOfflineDownloadsAllowed = (): boolean => {
  const { actingAs } = useAuth()
  return supportsOfflineDownload && actingAs === null
}
