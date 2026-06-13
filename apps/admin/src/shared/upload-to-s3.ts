export interface UploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface PutToPresignedUrlOptions {
  contentType?: string
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

/**
 * PUT a file to a presigned S3 URL via XMLHttpRequest so we get real upload
 * progress and can reject on a non-2xx status. A plain `fetch` has neither:
 * it gives no progress events for the request body and resolves even on a
 * 4xx/5xx, which is how a failed multi-GB upload used to "succeed" silently
 * and then enqueue transcoding of a missing object.
 */
export function putToPresignedUrl(
  url: string,
  file: File | Blob,
  options: PutToPresignedUrlOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)

    const contentType =
      options.contentType ?? (file instanceof File ? file.type : "")
    if (contentType) {
      xhr.setRequestHeader("Content-Type", contentType)
    }

    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        options.onProgress?.({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Не удалось загрузить файл (код ${xhr.status})`))
      }
    }
    xhr.onerror = () =>
      reject(new Error("Сетевая ошибка при загрузке файла. Попробуйте ещё раз."))
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"))

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort()
        return
      }
      options.signal.addEventListener("abort", () => xhr.abort(), {
        once: true,
      })
    }

    xhr.send(file)
  })
}
