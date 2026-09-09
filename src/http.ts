import { Response } from 'express'
import { AppError, AppErrorCode, ApiResult, ApiOk, ApiError } from './types.js'

export function ok<T extends object>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { success: true, ...data }
  res.status(status).json(body)
}

export function fail(res: Response, error: string, code: string, status: number): void {
  const body: ApiError = { success: false, error, code }
  res.status(status).json(body)
}

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  DUPLICATE: 409,
  QUEUE_FULL: 409,
  USER_LIMIT: 409,
  YOUTUBE_QUOTA: 503,
  YOUTUBE_ERROR: 503
}

export type ErrorInfo = { code: string; status: number; message: string }

export function getErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof AppError) {
    return { code: error.code, status: STATUS_BY_CODE[error.code], message: error.message }
  }

  const message = error instanceof Error ? error.message : 'не удалось выполнить запрос'
  return { code: 'SERVER_ERROR', status: 500, message }
}

export function failFromError(res: Response, error: unknown): void {
  const info = getErrorInfo(error)
  fail(res, info.message, info.code, info.status)
}
