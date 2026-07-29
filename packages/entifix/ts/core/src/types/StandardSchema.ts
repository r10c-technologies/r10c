/**
 * The [Standard Schema](https://standardschema.dev) v1 contract, vendored.
 *
 * Standard Schema is an interface, not a library: Zod, Valibot and ArkType all
 * expose `~standard` and nothing else is needed to run one. Declaring it here
 * lets an entity carry a real schema without `entifix-ts-core` — the bottom of
 * the stack — taking a runtime dependency on any validation library, and keeps
 * whichever one a domain picks an implementation detail of that domain.
 *
 * Only the parts a caller needs to *run* a schema are vendored; the inference
 * helpers from the published package are left out deliberately, since a draft
 * arrives as strings and is validated, never parsed into a typed value here.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** Contract version, for a consumer that has to branch on it. */
  readonly version: 1;
  /** The library that produced the schema (`zod`, `valibot`, …). */
  readonly vendor: string;
  /**
   * Validates a value. Returns issues on failure and the parsed value on
   * success — a Promise when the schema has async rules.
   */
  readonly validate: (
    value: unknown,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  readonly types?: { readonly input: Input; readonly output: Output };
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
  readonly message: string;
  /** Where the issue occurred; empty (or absent) means the value as a whole. */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}
