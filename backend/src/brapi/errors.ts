export class BrapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class BrapiAuthError extends BrapiError {} // 401
export class BrapiPlanError extends BrapiError {} // 403
export class BrapiNotFoundError extends BrapiError {} // 404
export class BrapiBadRequestError extends BrapiError {} // 400
export class BrapiRateLimitError extends BrapiError {
  // 429
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message, 429, "RATE_LIMITED");
  }
}
