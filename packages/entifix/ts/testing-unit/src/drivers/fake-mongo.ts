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
  if (typeof left === 'number' && typeof right === 'number') return left - right;
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

const matches = (doc: Document, query: QueryDocument): boolean =>
  Object.entries(query).every(([field, condition]) => {
    if (field === '$and') {
      return (condition as QueryDocument[]).every((child) =>
        matches(doc, child),
      );
    }
    if (field === '$or') {
      return (condition as QueryDocument[]).some((child) => matches(doc, child));
    }
    return matchesCondition(doc[field], condition);
  });

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
    Object.entries(seed).map(([name, docs]) => [name, docs.map((d) => ({ ...d }))]),
  );
  const operations: Array<{ collection: string; op: string }> = [];
  let failure: unknown;
  const failuresByOperation = new Map<string, unknown>();

  const documentsOf = (name: string): Document[] => {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name) as Document[];
  };

  const record = <TValue>(name: string, op: string, produce: () => TValue) => {
    operations.push({ collection: name, op });
    const scoped = failuresByOperation.get(op);
    if (scoped !== undefined) return Promise.reject(scoped);
    return failure !== undefined
      ? Promise.reject(failure)
      : Promise.resolve(produce());
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
            const matched = documentsOf(name).filter((doc) =>
              matches(doc, query),
            );
            const sorted = Object.entries(sortSpec).reduceRight(
              (items, [field, direction]) =>
                [...items].sort(
                  (left, right) => compare(left[field], right[field]) * direction,
                ),
              matched,
            );
            return sorted
              .slice(skipCount, skipCount + limitCount)
              .map((doc) => project(doc, options));
          }),
      };
      return cursor;
    },

    findOne: (query: QueryDocument, options?: { projection?: Document }) =>
      record(name, 'findOne', () => {
        const found = documentsOf(name).find((doc) => matches(doc, query));
        return found === undefined ? null : project(found, options);
      }),

    countDocuments: (query: QueryDocument = {}) =>
      record(name, 'countDocuments', () =>
        documentsOf(name).filter((doc) => matches(doc, query)).length,
      ),

    replaceOne: (
      query: QueryDocument,
      replacement: Document,
      options?: { upsert?: boolean },
    ) =>
      record(name, 'replaceOne', () => {
        const documents = documentsOf(name);
        const index = documents.findIndex((doc) => matches(doc, query));
        if (index === -1) {
          if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
          documents.push({ ...replacement });
          return { matchedCount: 0, upsertedCount: 1 };
        }
        documents[index] = { ...replacement };
        return { matchedCount: 1, upsertedCount: 0 };
      }),

    deleteOne: (query: QueryDocument) =>
      record(name, 'deleteOne', () => {
        const documents = documentsOf(name);
        const index = documents.findIndex((doc) => matches(doc, query));
        if (index === -1) return { deletedCount: 0 };
        documents.splice(index, 1);
        return { deletedCount: 1 };
      }),

    createIndex: (spec: Document, options?: Document) =>
      record(name, 'createIndex', () => ({ spec, options })),
  });

  return {
    seed: (name, documents) => {
      collections.set(name, documents.map((doc) => ({ ...doc })));
    },
    read: (name) => documentsOf(name).map((doc) => ({ ...doc })),
    failWith: (error) => {
      failure = error;
    },
    failOn: (operation, error) => {
      failuresByOperation.set(operation, error);
    },
    get operations() {
      return operations;
    },
    db: { collection },
  };
};
