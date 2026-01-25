export type HttpMethod = "get" | "post" | "put" | "patch" | "delete"

export interface HttpRequestConfig<TBody = unknown> {
  method: HttpMethod
  url: string
  data?: TBody
  params?: Record<string, unknown>
  headers?: Record<string, string>
}

export interface HttpClient {
  request<TResponse = unknown, TBody = unknown>(
    config: HttpRequestConfig<TBody>
  ): Promise<TResponse>
}
