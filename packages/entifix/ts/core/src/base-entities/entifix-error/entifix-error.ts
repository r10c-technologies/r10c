function assertCause(cause: unknown): Error | undefined {
  if (cause instanceof Error) {
    return cause;
  } else if (cause && typeof cause === 'object' && 'message' in cause) {
    return new Error(String(cause['message']));
  }

  return undefined;
}

export abstract class EntifixError extends Error {
  // #region properties
  abstract readonly _tag: string;
  override readonly cause: Error | undefined;
  readonly details?: Record<string, unknown>;
  // #endregion properties

  // #region constructors
  constructor(
    message: string,
    cause?: unknown,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.cause = assertCause(cause);
    this.details = details;
  }
  // #endregion constructors
}

export class EntifixBuildError extends EntifixError {
  // #region properties
  override _tag = 'EntifixBuildError';
  // #endregion properties
}

export class EntifixLogicError extends EntifixError {
  // #region properties
  override _tag = 'EntifixLogicError';
  // #endregion properties
}

export class EntifixConnError extends EntifixError {
  // #region properties
  override _tag = 'EntifixConnError';
  // #endregion properties
}

/**
 * A transaction/saga step failed (validate, execute, rollback, free) — distinct
 * from a lock acquisition failure, which callers retry, and from a build error,
 * which is the client's fault.
 */
export class EntifixTransactionError extends EntifixError {
  // #region properties
  override _tag = 'EntifixTransactionError';
  // #endregion properties
}

/**
 * A resource could not be locked within the allowed retries/TTL — a contention
 * signal callers surface as a `409`/`423`, not a `500`.
 */
export class EntifixLockError extends EntifixError {
  // #region properties
  override _tag = 'EntifixLockError';
  // #endregion properties
}
