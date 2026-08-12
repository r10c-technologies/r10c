/**
 * The verified caller, as auth-service's `/api/me` returns it.
 *
 * It lives at the package root rather than beside `loadPrincipal` in `server/`
 * so that a client component can name the shape without importing a module that
 * reads `next/headers`. `import type` would be erased anyway, but a client file
 * whose import list points at `server/` is one refactor away from pulling the
 * runtime in — and the failure mode is a build error about a server reference,
 * far from the line that caused it.
 */
export interface Principal {
  readonly userId: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}
