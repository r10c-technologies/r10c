# @r10c/entifix-ts-testing-unit

Shared test doubles, port contract suites, and HTTP stubbing for the workspace.
Test-only: it is private, has no build target, and resolves straight to source
through the `@r10c/source` condition. Depend on it as a `devDependency`.

## Vocabulary

Which kind of double to reach for, and where each lives:

| Kind             | What it is                                                    | Where                    |
| ---------------- | ------------------------------------------------------------- | ------------------------ |
| **Stub**         | Canned answers, no assertions on it                            | inline, or `makeStub*`   |
| **Fake**         | Working in-memory implementation of a **driven port**          | `.` (`makeInMemory*`)    |
| **Driver fake**  | Fake of a *third-party client*, one level below an adapter     | `./drivers`              |
| **Recording**    | A fake that records what happened, asserted as state           | `.` (`makeRecording*`)   |
| **MSW**          | The boundary for everything HTTP                               | `./http`                 |

Mocks with call assertions are a last resort, kept for cases where the
behaviour *is* the interaction (event publication, lock ordering, rollback).
Prefer a recording fake — `expect(bus.published)` reads as state, a spy
protocol does not.

## Entry points

```ts
import { makeInMemoryEntityRepository, runRepository } from '@r10c/entifix-ts-testing-unit';
import { makeFakeMongoDb } from '@r10c/entifix-ts-testing-unit/drivers';
import { entityRestHandlers, setupEntifixServer } from '@r10c/entifix-ts-testing-unit/http';
import { describeEntityRepositoryContract } from '@r10c/entifix-ts-testing-unit/contracts';
import { renderWithAdapters } from '@r10c/entifix-ts-testing-unit/react';
```

`.` carries no React and no msw, so TS-only packages pull neither.

## Why driver fakes rather than port fakes

A fake at the port level replaces the adapter, so none of the adapter's own code
runs — the filter translation, the `SET NX PX`, the envelope framing, the error
mapping all go unmeasured while coverage still reports the port as exercised.
The driver fakes sit one level lower, so the real adapter executes against them.

## Contract suites

Each driven port has one suite, run against **every** implementation:

```ts
describeEntityRepositoryContract('in-memory fake', { makeRepository: (seed) => makeInMemoryEntityRepository(seed) });
describeEntityRepositoryContract('mongo adapter over a fake driver', { makeRepository: (seed) => makeMongoRepository(fakeDb, Widget) });
```

This is what keeps a fake from quietly becoming a more forgiving version of the
thing it stands in for. `@r10c/entifix-ts-testing-integration` will later run
the same suites against real infrastructure.

## Known constraint

`@r10c/entifix-ts-business` and `@r10c/entifix-transactions` **cannot** use this
package: it is built on their interfaces, so depending on it from them is a
cycle. Those two define their doubles locally. Everything else uses this.
