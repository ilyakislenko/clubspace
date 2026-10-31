import * as FileSystem from "expo-file-system/legacy"
import { Platform, Share } from "react-native"

import { MY_DATA_MIME_TYPE, type SaveMyDataOutcome } from "./my-data-file"

/**
 * Puts the data export where the member can keep it. `save-my-data.web.ts` is
 * the browser counterpart (a Blob download); keep the two signatures in sync.
 *
 * - iOS: the file goes to the cache directory and into the share sheet (Save
 *   to Files, AirDrop, Mail). RN's Share only attaches a file `url` on iOS.
 * - Android: RN's Share can only send text and expo-sharing isn't a
 *   dependency, so the member picks a folder through the Storage Access
 *   Framework and the file is written there.
 */
export const saveMyData = async (
  fileName: string,
  json: string,
): Promise<SaveMyDataOutcome> => {
  if (Platform.OS === "android") {
    const saf = FileSystem.StorageAccessFramework
    const permission = await saf.requestDirectoryPermissionsAsync()
    if (!permission.granted) return "dismissed"
    // SAF appends the extension for the MIME type itself.
    const uri = await saf.createFileAsync(
      permission.directoryUri,
      fileName.replace(/\.json$/, ""),
      MY_DATA_MIME_TYPE,
    )
    await FileSystem.writeAsStringAsync(uri, json)
    return "saved"
  }

  const uri = `${FileSystem.cacheDirectory ?? ""}${fileName}`
  await FileSystem.writeAsStringAsync(uri, json)
  try {
    const result = await Share.share({ url: uri })
    return result.action === Share.dismissedAction ? "dismissed" : "shared"
  } finally {
    // Personal data must not linger in the cache once the sheet is done with
    // it (Share resolves after the chosen activity completes).
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
      () => undefined,
    )
  }
}
