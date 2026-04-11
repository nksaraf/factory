export interface ApiResponse<T> {
  success: boolean
  data?: T
  warnings?: string[]
  timing?: { startedAt: string; durationMs: number }
}

export interface ApiError {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    suggestions?: Array<{ action: string; description: string }>
  }
  exitCode: number
}
