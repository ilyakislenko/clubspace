export type HttpMethod = "get" | "post" | "put" | "patch" | "delete"

export interface HttpRequestConfig<TBody = unknown> {
  method: HttpMethod
  url: string
  data?: TBody
  params?: Record<string, unknown>
  headers?: Record<string, string>
  /** This request's timeout in ms, for the few that legitimately run long; unset = the client's. */
  timeout?: number
}

export interface HttpClient {
  request<TResponse = unknown, TBody = unknown>(
    config: HttpRequestConfig<TBody>
  ): Promise<TResponse>
}
