// Web twin of upload-file.ts: expo-file-system has no web backend, so the
// picked file (a blob: URL) is read and PUT with XMLHttpRequest, which — unlike
// fetch — reports upload progress.
export async function uploadFileWithProgress(p: {
  url: string
  fileUri: string
  contentType: string
  onProgress: (sentBytes: number, totalBytes: number) => void
}): Promise<void> {
  const body = await (await fetch(p.fileUri)).blob()
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", p.url)
    xhr.setRequestHeader("Content-Type", p.contentType)
    xhr.upload.onprogress = (event) => p.onProgress(event.loaded, event.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(`Хранилище не приняло файл (код ${xhr.status}). Попробуйте ещё раз.`),
          )
    xhr.onerror = () => reject(new Error("Нет сети — загрузка прервалась. Попробуйте ещё раз."))
    xhr.send(body)
  })
}
