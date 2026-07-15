# Local Council — AAA/ABAC module architecture

> **Local council** — these perspectives all come from Claude playing different
> roles, not from different AI vendors. Treat agreement as a shared starting
> point to pressure-test, not as independent confirmation.

**Question:** Build an AAA (auth/authz/accountability) module with ABAC across all
microservices in an Nx monorepo (Node 25, NestJS/Next, entifix + Effect, MongoDB
main store). Perimeter security + Redis session cache + SSO; "one user, many
identifiers"; Mongo main + some Postgres; Keycloak wrapped by auth-api/auth-app —
right approach? Alternatives welcome.

Roles convened: Security, Performance, Maintainability, Devil's Advocate,
Scalability, Developer Experience, Compliance. Model: Opus 4.8 (forced) for all.

---

## 🗳️ Security Auditor

**Position** — Buy, don't build the identity/credential core (Keycloak or Zitadel),
but don't let `auth-api` re-implement authentication primitives. Highest-risk
decisions: account-linking of multiple identifiers, credential storage location,
trusting gateway-injected identity headers.

**Key points**
- Rolling your own is the anti-pattern; a thin wrapper that leaks auth logic is the
  same anti-pattern in disguise. Keep `auth-api` a policy/orchestration facade over
  the IdP, never a second credential store. Scaffold is Express not Nest → enforcement
  hand-rolled middleware unless you add structure.
- "One user, many identifiers" is the biggest attack surface. Never auto-link on
  unverified email; require verification/step-up to attach an identifier; normalize
  (case-fold, NFC, reject confusables) before uniqueness. Keycloak has had
  account-linking CVEs when "trust email from IdP" is on.
- Perimeter should use opaque reference sessions, not bearer JWTs, for revocation.
  Opaque cookie at edge → gateway introspects Redis → mints short-lived signed
  audience-scoped internal token per downstream call.
- Confused-deputy: services must accept identity only from the gateway (mTLS or signed
  internal token), not a plaintext X-User-Id. Perimeter without internal zero-trust =
  one SSRF/compromised pod = full impersonation.
- ABAC: distribute the PEP (co-located OPA/Cedar), centralize authoring. Default-deny;
  unreachable PDP denies. Attributes from signed sources, not client headers.

**Risks & blind spots** — Accountability (3rd A) nearly absent: tamper-evident
append-only audit trail; audited principal must be original user. "Postgres-per-service
isolation" conflates schema with blast-radius isolation — Keycloak DB on same instance
as app data = crown jewels one misconfig away. Mongo operator-injection is an
authz-bypass vector. Redis session store high-value target. Effect/Context.Tag is a
security opportunity: required principal Tag → forgotten check = compile error.

**Confidence** — medium.

## 🗳️ Performance Optimizer

**Position** — The decision that matters most is where authorization runs relative to
the request path. A central network-hop PDP turns every call into 1–3 extra sync
round-trips. Push decision eval in-process with a fast replicated cache; reserve
network for revocation signals.

**Key points**
- Opaque-session-in-Redis is right for latency, but Redis is now on every request's
  critical path. Pool connections, same-AZ, never Redis GET + Keycloak introspection
  per request. One hot-path authority.
- JWT vs opaque is throughput-vs-revocation; ABAC changes the math (mutable attributes →
  long JWTs serve stale authz). Short-lived JWT (30–120s) + per-request eval against
  locally-cached attributes, Redis pub/sub invalidation.
- N+1 is the dominant risk in ABAC attribute fetching. Load subject attrs once at
  perimeter into context; pass resource attrs from already-loaded entity — don't let the
  engine re-query.
- Cedar/Casbin evaluate in-process (sub-ms, no hop); OpenFGA/Zanzibar = per-check network
  call, deep-graph expensive. OpenFGA only for genuine ReBAC.
- User Identifiers lookup is read-hottest → Postgres (unique index (provider, external_id),
  FK to user). Mongo array = doc growth/multikey bloat. Cache session→userId→attributes in
  Redis (once per login).

**Risks & blind spots** — Keycloak-per-request is a silent p99 killer. Redis = new
perimeter SPOF, no stated fallback (need local 1–5s cache + circuit breaker). Effect
composability hides fan-out cost. "Postgres-per-service on one instance" = shared
pool/WAL/CPU noisy-neighbor. Cross-region session propagation unaddressed.

**Confidence** — medium.

## 🗳️ Maintainability Advocate

**Position** — Buy the identity/session machinery + externalized versioned policy engine
(Cedar). Biggest risk isn't product — it's naming, the two-store split, and the wrapper
accumulating drift. Fix framing now while empty stubs.

**Key points**
- Scaffold is greenfield and layering is already right. Keep policy eval + identity
  resolution as Context.Tag services in business layer; Keycloak/Redis/PDP wiring only in
  shell. Use-cases never import an SDK.
- Rename `aaa` before it spreads → `business-ts-authn`, `-authz`, `-audit`. Devs grep
  "authorization", not "aaa".
- Externalize policy as versioned tested code, not per-service if chains. Cedar > OPA/Rego
  for a TS team; OpenFGA only if truly ReBAC. One `PolicyDecisionTag.check(...)`.
- One identity system of record (the IdP); Mongo as projection, never second writable
  source. Two writable copies = drift + reconciliation nobody owns.
- Contract tests are the deliverable: policy tests, session-cache adapter contract,
  auth-api-e2e token→PDP→decision. `test` currently passWithNoTests.

**Risks & blind spots** — Wrapper = permanent anti-corruption layer you own forever;
Zitadel needs a thinner one. Postgres-per-service = accidental coupling (migration locks,
backups, upgrades). Mongo/Postgres split has no stated rule → ad hoc per PR; write it now.
Redis ephemeral vs source-of-truth unresolved. Audit is the dropped "A" — needs an owner.

**Confidence** — medium.

## 🗳️ Devil's Advocate

**Position** — 3–4 hard distributed-systems problems bundled into one "module," designed
at a repo maturity (5 commits, mock APIs, stubs) that hasn't earned any of them.
"Keycloak-wrapped-by-your-own-api/app" = pay Keycloak's cost AND rebuild its surface,
netting less than either alone.

**Key points**
- Wrapping contradicts itself — Keycloak's value is the hosted login + identity model you
  propose to replace. Want a hosted product (thin adapter) or your own (don't need
  Keycloak's engine)? Wrapping is the expensive middle.
- Scaffold already fragments: auth-api is bare Express, rest is Nest + entifix + Effect.
  Already diverging from question #6.
- ABAC is a bigger commitment than the requirement probably needs — nothing described can't
  be RBAC + ownership checks. ABAC = combinatorial policy space + a second DSL. Prove you
  need attribute rules first.
- Opaque session in Redis re-centralizes what SSO decentralized. Cheap validation + instant
  revocation + no central dependency — pick two. Plan assumes all three.
- Three identity stores (Keycloak PG, Mongo user, second PG) = sync-bug generator. Where's
  the canonical id? Every link/merge = two-phase write, no shared transaction.

**Risks & blind spots** — "Postgres-per-service as a useful side effect" = rationalized
coupling. AAA is needed by everything = opposite of "dependencies point downward"; forcing
it into the acyclic layers erodes the boundary rule. Effect + imperative external systems =
un-costed impedance mismatch. Cheapest correct move: thin boring perimeter (one IdP hosted
login, short-TTL JWT + small revocation list, RBAC, single Mongo user store); defer
ABAC/Redis-SSO/Postgres until a concrete need forces each.

**Confidence** — medium.

## 🗳️ Scalability Architect

**Position** — Perimeter + Redis SSO + Keycloak is a fine day-one shape, but the two
decisions that decide 100x are opaque-session-at-gateway vs stateless-JWT-to-services, and
central PDP vs distributed policy eval.

**Key points**
- A central PDP is a per-request synchronous fan-in — don't build one (sees N×RPS; p99 tail
  at 10x, SPOF at 100x). Distributed enforcement + central authoring. OpenFGA/Keto only for
  genuine relationship graphs + short-TTL cache.
- Redis is the SSO session store, not the authz store. Redis Cluster hash-tagged keys
  {user:<id>}; aggressive TTLs; DB is source of truth.
- Opaque-at-edge, short-lived-JWT-to-services scales revocation AND throughput (gateway
  checks Redis once, mints 30–120s token verified locally). Lets you add the 50th service.
- User Identifiers = hot fan-in read → denormalized index identifier→canonical userId. Keep
  canonical userId stable and IdP-independent so Keycloak is swappable.
- Buy AuthN, own AuthZ, decouple their scaling. Login is spiky; ABAC eval is every-request.
  Coupling makes the policy engine inherit Keycloak's JVM profile. Zitadel/Ory sidesteps.

**Risks & blind spots** — Postgres-per-service in one instance = zero resource isolation;
Keycloak needs its own Postgres. Mongo+Postgres dual-write, no transaction → stale
policy-relevant attribute = authz correctness issue. Attribute freshness is the ABAC
scaling tax (push bounded set into token at mint). Multi-region under-weighted — central
PDP doesn't survive going global.

**Confidence** — medium.

## 🗳️ Developer Experience

**Position** — Backend product matters far less than (1) what a dev types/tests to make an
authz decision and (2) whether a denied request says why. Letting Keycloak own the user
record is riskiest; pick the policy engine by authoring/debugging tooling.

**Key points**
- Scaffold leaks inconsistency: auth-api is raw Express, rest is Nest + Effect/Context.Tag =
  a third framework mental model. Standardize on Nest before it hardens.
- Authz call site decides daily DX: PrincipalTag + PolicyDecisionTag yielded inside a UC like
  EntityRepositoryTag in load-products.uc.ts. Return allow/deny + human-readable reason. Cedar
  kinder to author/test than Rego; OpenFGA is ReBAC = mismatch.
- Keycloak-as-source-of-truth-for-users is the worst DX trap. Own User/EntityIdentifier as
  entifix entities; Keycloak = auth broker.
- Give every service ONE guard hydrating a typed Principal into Effect context. Opaque+Redis
  weak for local dev — offset with seeded sessions + dev-login shortcut.
- Polyglot Mongo+Postgres doubles local tax; Postgres-per-service-side-effect is a smell.

**Risks & blind spots** — Effect Requirements-channel bloat (ship a pre-composed Layer/helper).
Onboarding cost invisible (Keycloak+PG+Redis+Mongo containers; seeded fixtures + dev-auth
bypass day one). Untestable policies = unwritten policies. Opaque 403s across the perimeter —
propagate correlation id + decision reason to logs, generic message to client.

**Confidence** — medium.

---

# Synthesis — angles, not consensus

## Shared starting points (a prior to stress-test, not corroboration)
1. Opaque session at the edge, short-lived signed token to services (5/7).
2. Distributed enforcement, central authoring — never a central per-request PDP.
3. Cedar > OPA/Rego for a TS team; OpenFGA is a mismatch for attribute rules (it's ReBAC).
4. Own the canonical user + identifiers yourself, id IdP-independent; Keycloak = broker.

What they may all miss for the same reason: they accepted the microservices+perimeter+SSO+ABAC
frame and optimized within it. Only the Devil questioned whether the frame is earned at 5
commits + mock APIs. Shared blind spot = scope, not mechanics.

## Genuine tensions
- ABAC now vs RBAC-now-ABAC-later — resolve by writing 3–5 real access rules. If all "role X can
  do Y" / "owner edits own", start RBAC + ownership behind a PolicyDecisionTag seam.
- Keycloak vs Zitadel — everyone says buy; several lean Zitadel (API-first, thinner wrapper, no
  JVM). If you own the user aggregate + thin wrapper, Zitadel likely cheaper long-term.
- Redis as tier-0 platform dependency — local cache + circuit breaker partly reintroduces the
  staleness opaque sessions avoid. Accept bounded staleness explicitly.

## Blind spots one member caught
- Confused-deputy (Security): trusting plaintext X-User-Id makes the whole perimeter bypassable.
- Accountability (3rd A) nearly absent — needs owner+schema; tamper-evident vs GDPR erasure tension.
- Account-linking is the top takeover vector (verified proof + step-up, log link/unlink, normalize).
- NoSQL operator injection on Mongo identifier/attribute lookups = authz-bypass primitive.
- Nothing covered: regulatory scope (GDPR/PCI/HIPAA) — resolve before locking the identity model.

## Suggested direction
1. Fix the Express-vs-Nest stack inconsistency first (cheapest now).
2. Own User + EntityIdentifier as entifix entities in business/ts/aaa, id IdP-independent; rename aaa.
3. Buy the credential core; strongly evaluate Zitadel over Keycloak; keep it an auth broker.
4. Model authz as PrincipalTag + PolicyDecisionTag returning allow/deny + reason; start RBAC +
   ownership behind that seam; adopt Cedar only when a real attribute rule forces it.
5. Opaque session in Redis at a gateway → short-lived signed token to services; identity only via
   signed token/mTLS, never plaintext header; design local cache + circuit breaker for Redis SPOF.
6. Write the Mongo/Postgres rule down; give the IdP its own Postgres instance (not a sibling DB).
7. Design accountability + account-linking + regulatory scope up front.

Real uncertainty: whether ABAC and full Redis-SSO are warranted now — only your actual access
rules and load profile answer that. If simple, the Devil's "thin boring perimeter, defer the
rest" is the cheaper correct path; the other six describe your target, not your next PR.
