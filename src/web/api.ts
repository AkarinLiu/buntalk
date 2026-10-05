/**
 * Thin typed wrapper over `fetch` for the `/api` surface.
 *
 * Every non-2xx body is `{ error }`, so failures always surface as `ApiError`
 * with a message that is safe to render straight into a form.
 */
import type { CategoryRow, PostRow, PublicUser, ThreadRow } from '../shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Message safe to show the user — never a stack trace or `undefined`. */
export const errMessage = (err: unknown, fallback = '操作失败'): string =>
  err instanceof Error && err.message ? err.message : fallback

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    // non-JSON body (proxy/5xx page) — fall through to the generic message
    return {}
  }
}

function failed(res: Response, data: unknown): ApiError {
  const message =
    data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `请求失败 (${res.status})`
  return new ApiError(message, res.status)
}

async function request<T>(path: string, method: string, body?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body,
  })
  const data = await parseBody(res)
  if (!res.ok) throw failed(res, data)
  return data as T
}

/**
 * Uploads a single file. Separate from `request` because the browser has to set
 * the multipart Content-Type itself, boundary included — setting it by hand
 * produces a body the server cannot parse.
 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/uploads', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  const data = await parseBody(res)
  if (!res.ok) throw failed(res, data)
  return data as UploadResponse
}

const json = (body: unknown) => JSON.stringify(body)

export const http = {
  get: <T>(path: string) => request<T>(path, 'GET'),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, 'POST', body === undefined ? undefined : json(body)),
  patch: <T>(path: string, body: unknown) => request<T>(path, 'PATCH', json(body)),
  del: <T>(path: string) => request<T>(path, 'DELETE'),
}

// Response shapes that span more than one endpoint.
export interface SessionResponse {
  user: PublicUser | null
}
export interface ThreadDetailResponse {
  thread: ThreadRow
  posts: PostRow[]
}
export interface ProfileResponse {
  user: PublicUser
  threadCount: number
  postCount: number
}
export interface LikeResponse {
  liked: boolean
  likeCount: number
}
export interface IdResponse {
  id: number
}
export interface UploadResponse {
  key: string
  /** Stable public path: `/uploads/<key>`, on every storage backend. */
  url: string
  mime: string
  size: number
}
export type CategoriesResponse = CategoryRow[]
export type ThreadsResponse = ThreadRow[]
