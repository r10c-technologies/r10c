/**
 * Framework-free contract surface: the tags, use-cases, principal and errors a
 * perimeter service consumes — with NO entity classes.
 *
 * The entity model (`UserIdentity`, `EntityIdentifier`) uses stage-3 (TC39)
 * decorators via entifix. A NestJS app compiles with legacy
 * (`experimentalDecorators`) decorators for its own DI, and the two decorator
 * emit modes cannot share one swc/tsc compilation. Importing this subpath keeps
 * the entity modules out of a Nest app's bundle, so the perimeter never
 * recompiles entity decorators in legacy mode. Adapters and the REST/React
 * side, which compile stage-3, import the package root (`.`) instead.
 */
export * from './errors';
export * from './repository';
export * from './use-cases/resolve-session';
export * from './values';
