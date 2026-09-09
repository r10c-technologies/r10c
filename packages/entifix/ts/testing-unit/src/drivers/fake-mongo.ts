/**
 * A fake of the mongodb driver, not of the repository port.
 *
 * It sits one level *below* `makeMongoRepository`, so the adapter's own code —
 * the filter translation, the projection, the upsert rule, the error mapping —
 * actually runs and is measured by coverage. A fake at the port level would
 * skip all of it.
 *
 * Only the surface the adapter uses is implemented; anything else is a
 * deliberate `TypeError` rather than a silent no-op.
 */

/** The subset of a Mongo query document the adapter produces. */
type QueryDocument = Record<string, unknown>;
type Document = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Document =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compare = (left: unknown, right: unknown): number => {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number')
    return left - right;
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left).localeCompare(String(right));
};

/** Evaluates one `{ $op: value }` condition against a document field. */
const matchesCondition = (actual: unknown, condition: unknown): boolean => {
  if (!isPlainObject(condition)) {
    return actual === condition;
  }

  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '$eq':
        return actual === operand;
      case '$ne':
        return actual !== operand;
      case '$gt':
        return compare(actual, operand) > 0;
      case '$gte':
        return compare(actual, operand) >= 0;
      case '$lt':
        return compare(actual, operand) < 0;
      case '$lte':
        return compare(actual, operand) <= 0;
      case '$in':
        return (operand as unknown[]).includes(actual);
      case '$nin':
        return !(operand as unknown[]).includes(actual);
      case '$not':
        return !matchesCondition(actual, operand);
      case '$regex':
        return new RegExp(
          operand as string,
          (condition['$options'] as string) ?? '',
        ).test(String(actual));
      case '$options':
        // Handled together with `$regex`.
        return true;
      default:
        throw new TypeError(`fake mongo: unsupported operator "${operator}"`);
    }
  });
};

/**
 * Evaluates one node of an aggregation expression — the `$expr` half of a
 * query, which is a different language from the operators above: it compares
 * two *fields of the same document* rather than a field against a constant.
 *
 * Only the shape a conditional stock write sends is implemented — a
 * `$subtract` of two field paths compared with `$gte` — and anything else is a
 * `TypeError`. That is the same rule the rest of this file follows: a fake that
 * quietly evaluated an expression it does not understand would answer `true`
 * for a document the real server would have refused, which turns an
 * oversell-prevention test into a test that asserts nothing.
 */
const evaluateExpression = (doc: Document, node: unknown): unknown => {
  if (typeof node === 'string' && node.startsWith('$')) {
    return doc[node.slice(1)];
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const entries = Object.entries(node);
  if (entries.length !== 1) {
    throw new TypeError(
      `fake mongo: $expr node must have exactly one operator, got ${entries.length}`,
    );
  }
  const [operator, operand] = entries[0];
  const operands = (operand as unknown[]).map(child =>
    evaluateExpression(doc, child),
  );

  switch (operator) {
    case '$subtract':
      return (operands[0] as number) - (operands[1] as number);
    case '$add':
      return (operands[0] as number) + (operands[1] as number);
    case '$gte':
      return compare(operands[0], operands[1]) >= 0;
    case '$gt':
      return compare(operands[0], operands[1]) > 0;
    case '$lte':
      return compare(operands[0], operands[1]) <= 0;
    case '$lt':
      return compare(operands[0], operands[1]) < 0;
    case '$eq':
      return operands[0] === operands[1];
    default:
      throw new TypeError(
        `fake mongo: unsupported $expr operator "${operator}"`,
      );
  }
};

const matches = (doc: Document, query: QueryDocument): boolean =>
  Object.entries(query).every(([field, condition]) => {
    if (field === '$and') {
      return (condition as QueryDocument[]).every(child => matches(doc, child));
    }
    if (field === '$or') {
      return (condition as QueryDocument[]).some(child => matches(doc, child));
    }
    if (field === '$expr') {
      return evaluateExpression(doc, condition) === true;
    }
    return matchesCondition(doc[field], condition);
  });

/**
 * The error a real server raises when a write violates a unique index.
 *
 * The `code` matters and the message does not: callers recognise a duplicate
 * key by `error.code === 11000` (or the same code inside `writeErrors`), and a
 * fake that threw a plain `Error` would send a retry path that exists precisely
 * for this case down the "unexpected failure" branch instead.
 */
class FakeDuplicateKeyError extends Error {
  readonly code = 11000;

  constructor(collection: string, key: Document) {
    super(
      `fake mongo: E11000 duplicate key error collection: ${collection} dup key: ${JSON.stringify(key)}`,
    );
    this.name = 'MongoServerError';
  }
}

export interface FakeMongoCollection {
  /** The documents currently stored, as the driver would return them. */
  readonly documents: Document[];
}

export interface FakeMongoDb {
  /** Replaces a collection's contents. */
  seed(collection: string, documents: Document[]): void;
  /** Reads a collection's current contents. */
  read(collection: string): Document[];
  /**
   * Makes every subsequent driver call reject with `error`, so the adapter's
   * `EntifixConnError` mapping is reachable. Pass `undefined` to restore.
   */
  failWith(error: unknown): void;
  /**
   * Makes only `operation` reject, leaving the rest working — the way a read
   * that succeeds and a count that then fails reaches a distinct error branch.
   */
  failOn(operation: string, error: unknown): void;
  /** Every operation performed, for assertions about what the adapter did. */
  readonly operations: ReadonlyArray<{ collection: string; op: string }>;
  /**
   * Opens a session whose `withTransaction` rolls the whole store back when its
   * body throws. What a service hands to `client.startSession()`; see the
   * implementation for why it is atomicity and not isolation.
   */
  startSession(): {
    withTransaction(body: () => Promise<unknown>): Promise<unknown>;
    endSession(): Promise<void>;
    readonly hasEnded: boolean;
  };
  /** The object to hand to `makeMongoRepository` in place of a real `Db`. */
  readonly db: unknown;
}

/**
 * Builds an in-memory stand-in for a mongodb `Db`.
 *
 * `db` is typed `unknown` on purpose: casting it at the call site keeps this
 * package free of a hard dependency on the `mongodb` types while remaining
 * honest that it is not a real driver.
 */
export const makeFakeMongoDb = (
  seed: Record<string, Document[]> = {},
): FakeMongoDb => {
  const collections = new Map<string, Document[]>(
    Object.entries(seed).map(([name, docs]) => [
      name,
      docs.map(d => ({ ...d })),
    ]),
  );
  const operations: Array<{ collection: string; op: string }> = [];
  let failure: unknown;
  const failuresByOperation = new Map<string, unknown>();

  const documentsOf = (name: string): Document[] => {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name) as Document[];
  };

  /**
   * The unique indexes `createIndex` has been asked for, per collection, as the
   * field lists they key on.
   *
   * Recording them is not bookkeeping: `updateOne` with `upsert` is atomic per
   * *document*, so two concurrent upserts for the same key each fail to see the
   * other's uncommitted insert and each create a row. The index is what makes
   * the fold singular, and a fake that accepted `createIndex` as a no-op would
   * report a service as covered while the property the index exists for went
   * untested (ADR 0010).
   */
  const uniqueIndexes = new Map<string, string[][]>();

  const uniqueIndexesOf = (name: string): string[][] =>
    uniqueIndexes.get(name) ?? [];

  /**
   * Refuses `candidate` if it would duplicate an existing document under one of
   * the collection's unique indexes.
   *
   * `ignored` is the document being replaced by an update, which must not count
   * as its own duplicate. A key whose value is `undefined` on the candidate is
   * skipped: a real index treats a missing field as `null` and would collide,
   * but nothing in this repo indexes an optional member, and guessing wrong
   * here would fail writes the server accepts.
   */
  const assertUnique = (
    name: string,
    candidate: Document,
    ignored?: Document,
  ): void => {
    for (const fields of uniqueIndexesOf(name)) {
      if (fields.some(field => candidate[field] === undefined)) continue;
      const clash = documentsOf(name).find(
        doc =>
          doc !== ignored &&
          fields.every(field => doc[field] === candidate[field]),
      );
      if (clash !== undefined) {
        throw new FakeDuplicateKeyError(
          name,
          Object.fromEntries(fields.map(field => [field, candidate[field]])),
        );
      }
    }
  };

  const record = <TValue>(name: string, op: string, produce: () => TValue) => {
    operations.push({ collection: name, op });
    const scoped = failuresByOperation.get(op);
    if (scoped !== undefined) return Promise.reject(scoped);
    if (failure !== undefined) return Promise.reject(failure);
    // `try`/`catch` rather than `Promise.resolve(produce())`: a real driver
    // returns a promise and *rejects*, so a fake that threw synchronously would
    // need different handling at every call site than the thing it stands in for.
    try {
      return Promise.resolve(produce());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  /** Applies `{ projection: { _id: 0 } }`, the only projection the adapter uses. */
  const project = (doc: Document, options?: { projection?: Document }) => {
    const copy = { ...doc };
    if (options?.projection && options.projection['_id'] === 0) {
      delete copy['_id'];
    }
    return copy;
  };

  const collection = (name: string) => ({
    find: (query: QueryDocument = {}, options?: { projection?: Document }) => {
      let sortSpec: Record<string, 1 | -1> = {};
      let skipCount = 0;
      let limitCount = Infinity;

      const cursor = {
        sort(spec: Record<string, 1 | -1>) {
          sortSpec = spec;
          return cursor;
        },
        skip(count: number) {
          skipCount = count;
          return cursor;
        },
        limit(count: number) {
          limitCount = count;
          return cursor;
        },
        toArray: () =>
          record(name, 'find', () => {
            const matched = documentsOf(name).filter(doc =>
              matches(doc, query),
            );
            const sorted = Object.entries(sortSpec).reduceRight(
              (items, [field, direction]) =>
                [...items].sort(
                  (left, right) =>
                    compare(left[field], right[field]) * direction,
                ),
              matched,
            );
            return sorted
              .slice(skipCount, skipCount + limitCount)
              .map(doc => project(doc, options));
          }),
      };
      return cursor;
    },

    findOne: (query: QueryDocument, options?: { projection?: Document }) =>
      record(name, 'findOne', () => {
        const found = documentsOf(name).find(doc => matches(doc, query));
        return found === undefined ? null : project(found, options);
      }),

    countDocuments: (query: QueryDocument = {}) =>
      record(
        name,
        'countDocuments',
        () => documentsOf(name).filter(doc => matches(doc, query)).length,
      ),

    // Used by the services' own seeding, which the e2e `mock` profile runs for
    // real so both profiles serve the same catalog.
    insertMany: (documents: Document[]) =>
      record(name, 'insertMany', () => {
        const stored = documentsOf(name);
        for (const document of documents) {
          assertUnique(name, document);
          stored.push({ ...document });
        }
        return { insertedCount: documents.length };
      }),

    /**
     * A single insert — how an append-only ledger grows, and how a hold is
     * written beside the counter it moved.
     *
     * The options argument is accepted and ignored except for its `session`,
     * which the transaction wrapper already handles: a caller that passes one
     * is inside `withTransaction`, and this fake's rollback is a snapshot of
     * the whole store rather than anything per-operation.
     */
    insertOne: (document: Document) =>
      record(name, 'insertOne', () => {
        assertUnique(name, document);
        documentsOf(name).push({ ...document });
        return { acknowledged: true, insertedId: document['id'] ?? null };
      }),

    replaceOne: (
      query: QueryDocument,
      replacement: Document,
      options?: { upsert?: boolean },
    ) =>
      record(name, 'replaceOne', () => {
        const documents = documentsOf(name);
        const index = documents.findIndex(doc => matches(doc, query));
        if (index === -1) {
          if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
          documents.push({ ...replacement });
          return { matchedCount: 0, upsertedCount: 1 };
        }
        documents[index] = { ...replacement };
        return { matchedCount: 1, upsertedCount: 0 };
      }),

    /**
     * Partial update. `$set`, `$addToSet`, `$inc` and `$setOnInsert` are
     * implemented — the operators the adapters and the stock ledger use — and
     * **anything else throws**, because a fake that silently accepted `$unset`
     * without applying it would let a spec pass on an update that never
     * happened.
     *
     * `$addToSet` is what links an identifier onto `user-identity.identifiers`
     * without duplicating it on a repair run; supporting it here rather than
     * ignoring it is the difference between the e2e proving the link and merely
     * not noticing its absence.
     *
     * `$inc` with `upsert` is how a quantity moves. It matters that it is a
     * real increment and not a read-modify-write even here: the whole rule it
     * implements is that an absolute-value write loses updates, so a fake that
     * computed the new total from a value it had already read would model the
     * bug rather than the fix.
     */
    updateOne: (
      query: QueryDocument,
      update: {
        $set?: Document;
        $addToSet?: Document;
        $inc?: Document;
        $setOnInsert?: Document;
      },
      options?: { upsert?: boolean },
    ) =>
      record(name, 'updateOne', () => {
        const supported = ['$set', '$addToSet', '$inc', '$setOnInsert'];
        const unsupported = Object.keys(update).filter(
          operator => !supported.includes(operator),
        );
        if (unsupported.length > 0) {
          throw new Error(
            `fake-mongo: updateOne does not implement ${unsupported.join(', ')}`,
          );
        }

        // A real server rejects an update whose operators both name one field,
        // and the message is the one this repro'd against: `$setOnInsert` that
        // also named a field `$inc` touches. Reproducing the refusal is what
        // keeps the fake from blessing an update Mongo would refuse.
        const conflicting = Object.keys(update.$setOnInsert ?? {}).filter(
          field => field in (update.$inc ?? {}) || field in (update.$set ?? {}),
        );
        if (conflicting.length > 0) {
          throw new Error(
            `fake-mongo: updateOne has conflicting paths in $setOnInsert and $inc/$set: ${conflicting.join(', ')}`,
          );
        }

        /** `$set`, `$addToSet` and `$inc`, which apply on both branches. */
        const applyOperators = (base: Document): Document => {
          const updated = { ...base, ...(update.$set ?? {}) };
          for (const [field, value] of Object.entries(update.$addToSet ?? {})) {
            const current = updated[field];
            const array = Array.isArray(current) ? current : [];
            if (!array.includes(value)) {
              updated[field] = [...array, value];
            }
          }
          for (const [field, delta] of Object.entries(update.$inc ?? {})) {
            // An absent field is created at the increment's value, which is
            // exactly why `$setOnInsert` must not also name it.
            const current = updated[field];
            updated[field] =
              (typeof current === 'number' ? current : 0) + (delta as number);
          }
          return updated;
        };

        const documents = documentsOf(name);
        const index = documents.findIndex(doc => matches(doc, query));

        if (index === -1) {
          if (options?.upsert !== true) {
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          }
          // The upserted document starts from the query's *equality* fields,
          // the way a real server seeds one — an operator condition contributes
          // nothing, which is why a `$expr`-guarded upsert would insert a row
          // missing the very field it filtered on.
          const seedFields = Object.fromEntries(
            Object.entries(query).filter(
              ([field, condition]) =>
                !field.startsWith('$') && !isPlainObject(condition),
            ),
          );
          const inserted = applyOperators({
            ...seedFields,
            ...(update.$setOnInsert ?? {}),
          });
          assertUnique(name, inserted);
          documents.push(inserted);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }

        const updated = applyOperators(documents[index]);
        assertUnique(name, updated, documents[index]);
        documents[index] = updated;
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }),

    deleteOne: (query: QueryDocument) =>
      record(name, 'deleteOne', () => {
        const documents = documentsOf(name);
        const index = documents.findIndex(doc => matches(doc, query));
        if (index === -1) return { deletedCount: 0 };
        documents.splice(index, 1);
        return { deletedCount: 1 };
      }),

    /**
     * Declares an index, and **enforces it when it is unique**.
     *
     * Idempotent, like the real one: a service that ensures its index per
     * request rather than at boot — because a tenant database only appears on
     * first write — calls this on every write.
     */
    createIndex: (spec: Document, options?: Document) =>
      record(name, 'createIndex', () => {
        if (options?.['unique'] === true) {
          const fields = Object.keys(spec);
          const existing = uniqueIndexes.get(name) ?? [];
          const already = existing.some(
            candidate =>
              candidate.length === fields.length &&
              candidate.every((field, at) => field === fields[at]),
          );
          if (!already) {
            uniqueIndexes.set(name, [...existing, fields]);
          }
        }
        return { spec, options };
      }),
  });

  /**
   * A session whose `withTransaction` really rolls back.
   *
   * ⚠️ **It is atomicity, not isolation, and the difference decides where a
   * test may live.** The store is a single-threaded object graph, so nothing
   * runs concurrently with the body and a "race" here resolves in the order it
   * was written: a concurrency property — two writers contending for the last
   * unit — is green under this fake no matter what the code does, and belongs
   * in a `*.live.spec.ts` against real Mongo (ADR 0010).
   *
   * What it *does* model is the abort path, which is worth having: a body that
   * throws leaves the store exactly as it found it, so a conditional write that
   * moves a counter and then fails to write its row cannot leave the counter
   * moved. That is a real bug shape, and one a fake without rollback would hide
   * by committing half of it.
   */
  const startSession = () => {
    let open = true;
    return {
      withTransaction: async (body: () => Promise<unknown>) => {
        const snapshot = new Map(
          [...collections].map(([name, docs]) => [
            name,
            docs.map(doc => ({ ...doc })),
          ]),
        );
        try {
          return await body();
        } catch (error) {
          collections.clear();
          for (const [name, docs] of snapshot) collections.set(name, docs);
          throw error;
        }
      },
      endSession: () => {
        open = false;
        return Promise.resolve();
      },
      get hasEnded() {
        return !open;
      },
    };
  };

  return {
    seed: (name, documents) => {
      collections.set(
        name,
        documents.map(doc => ({ ...doc })),
      );
    },
    read: name => documentsOf(name).map(doc => ({ ...doc })),
    failWith: error => {
      failure = error;
    },
    failOn: (operation, error) => {
      failuresByOperation.set(operation, error);
    },
    get operations() {
      return operations;
    },
    startSession,
    db: { collection },
  };
};
