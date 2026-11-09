/**
 * Error domain = kategori baku API (`code`) + subkode (`reason`) — api-design §1.2 / §1.2.1.
 * Domain & application melempar DomainError; adapter HTTP memetakannya ke status + envelope.
 */
export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  BUSINESS_RULE: 422,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly reason: string | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, reason?: string, message?: string, details?: unknown) {
    super(message ?? reason ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.reason = reason;
    this.details = details;
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
