/**
 * A `@useCase()`-decorated class.
 *
 * It is never instantiated: the class exists because stage-3 decorators apply to
 * classes, methods, fields and accessors only, so `@useCase() export function
 * publishUC()` does not parse. The class is what makes annotation possible at
 * all, and its behaviour lives in a static.
 */
export type UseCaseConstructor = new (
  // Same reason as `EntityConstructor`: the parameters are the author's business.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => unknown;
