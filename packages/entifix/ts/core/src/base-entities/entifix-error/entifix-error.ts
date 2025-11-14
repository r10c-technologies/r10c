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
  // #endregion properties

  // #region constructors
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = assertCause(cause);
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
