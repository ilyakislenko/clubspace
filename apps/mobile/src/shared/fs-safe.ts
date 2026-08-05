import * as FileSystem from "expo-file-system/legacy"

/**
 * expo-file-system/legacy under the new Android architecture has been
 * observed to hang indefinitely on `getInfoAsync` / `readAsStringAsync`
 * etc. when the file or its parent directory has never been written.
 * Until we migrate to the new file-system API, these helpers race every
 * call against a short timeout so the UI never gets stuck.
 *
 * `fs-safe.web.ts` implements this same API on localStorage — expo-file-system
 * has no web backend, so every call here fails silently on the PWA. Keep the
 * two in sync: anything added below needs a web counterpart, or it becomes
 * another feature that quietly does nothing in a browser.
 */

// Root for everything the app persists. Callers build their paths from this
// rather than reaching for `FileSystem.documentDirectory` themselves, so the web
// implementation can substitute a namespace that has nothing to do with files.
export const DOCUMENT_DIR = FileSystem.documentDirectory ?? ""

const DEFAULT_TIMEOUT = 1500

const withTimeout = <T,>(promise: Promise<T>, fallback: T, ms = DEFAULT_TIMEOUT) => {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export const safeGetInfo = async (
  path: string,
): Promise<{ exists: boolean; uri?: string; size?: number; isDirectory?: boolean }> => {
  try {
    const info = await withTimeout(
      FileSystem.getInfoAsync(path) as Promise<{
        exists: boolean
        uri?: string
        size?: number
        isDirectory?: boolean
      }>,
      { exists: false },
    )
    return info
  } catch {
    return { exists: false }
  }
}

export const safeReadString = async (path: string): Promise<string | null> => {
  try {
    const text = await withTimeout(
      FileSystem.readAsStringAsync(path),
      null as string | null,
      2_000,
    )
    return text
  } catch {
    return null
  }
}

export const safeWriteString = async (
  path: string,
  content: string,
): Promise<boolean> => {
  try {
    // Report failure HONESTLY: the timeout arm resolves false (not the write's
    // success value), so a write that hangs past the deadline returns false
    // instead of masquerading as success (which silently dropped data).
    return await Promise.race<boolean>([
      FileSystem.writeAsStringAsync(path, content).then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 2_000),
      ),
    ])
  } catch {
    return false
  }
}

export const safeMakeDir = async (path: string): Promise<void> => {
  try {
    await withTimeout(
      FileSystem.makeDirectoryAsync(path, { intermediates: true }),
      undefined,
      1_500,
    )
  } catch {
    /* noop */
  }
}

export const safeDelete = async (path: string): Promise<void> => {
  try {
    await withTimeout(
      FileSystem.deleteAsync(path, { idempotent: true }),
      undefined,
      2_000,
    )
  } catch {
    /* noop */
  }
}

export const safeListDir = async (path: string): Promise<string[]> => {
  try {
    return await withTimeout(
      FileSystem.readDirectoryAsync(path),
      [] as string[],
      1_500,
    )
  } catch {
    return []
  }
}
