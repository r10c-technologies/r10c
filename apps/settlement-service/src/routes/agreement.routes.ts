import { HttpRouter } from '@effect/platform';
import { SalesChannelTypes } from '@r10c/business-ts-sales-vocabulary';
import { Agreement } from '@r10c/business-ts-settlement-management';
import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  emptyPageRoute,
  guarded,
  listRoute,
  notFoundRoute,
  saveRoute,
} from './entity-crud';
import {
  settlementInScope,
  settlementScopeFilter,
  settlementScopeFor,
} from './settlement-scope';

/** Basis points, so 10000 is the whole sale. */
const WHOLE_SALE_BASIS_POINTS = 10_000;

/**
 * What the deserializer will accept and an invoice will not survive.
 *
 * ⚠️ **`channelCommissionBasisPoints` is a map, and nothing about its metadata
 * constrains its keys.** The accessor declares `type: 'number'` because the
 * framework has no map type; `readEntityEnvelope` therefore assigns whatever
 * object arrives. A key that is not a real `SalesChannelType` is not a
 * validation nicety — `commissionFor` looks the sale's channel type up and finds
 * nothing, so the line silently falls through to the default rate and the vendor
 * is billed at a rate nobody agreed. A wrong invoice rather than an error, which
 * is the failure mode ADR 0024 named for this member.
 *
 * The range check is the same argument. A rate above 10000 charges more
 * commission than the sale was worth, and a negative one pays the vendor to
 * sell — both arithmetic the fold would carry out faithfully.
 *
 * ⚠️ **`0` is valid and must stay valid.** "We take nothing on your own counter"
 * is the term the per-channel map exists for, so every check here tests bounds
 * and never truthiness.
 */
export const validateAgreement = (
  agreement: Agreement,
): EntifixBuildError | undefined => {
  const outOfRange = (basisPoints: number): boolean =>
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > WHOLE_SALE_BASIS_POINTS;

  if (outOfRange(agreement.commissionBasisPoints)) {
    return new EntifixBuildError(
      `commissionBasisPoints must be a whole number between 0 and ${WHOLE_SALE_BASIS_POINTS}`,
    );
  }

  const rates = agreement.channelCommissionBasisPoints;
  if (rates === undefined) {
    return undefined;
  }

  for (const [channelType, basisPoints] of Object.entries(rates)) {
    if (!(SalesChannelTypes as readonly string[]).includes(channelType)) {
      return new EntifixBuildError(
        `channelCommissionBasisPoints names "${channelType}", which is not a sales channel type`,
      );
    }
    if (basisPoints !== undefined && outOfRange(basisPoints)) {
      return new EntifixBuildError(
        `channelCommissionBasisPoints["${channelType}"] must be a whole number between 0 and ${WHOLE_SALE_BASIS_POINTS}`,
      );
    }
  }

  return undefined;
};

/**
 * The vendor's commercial terms.
 *
 * ⚠️ **Read is scoped, write is not granted to any role.** A vendor reads their
 * own agreement and nobody else's; authoring one is an operator act, reached
 * through `super-admin`'s wildcard rather than through a grant of its own,
 * because setting what the platform charges a vendor is not a thing the vendor's
 * own administrator does.
 *
 * ⚠️ **`$metadata` is registered before `/:id`.** `find-my-way-ts` prefers a
 * static segment over a parametric one and does not backtrack, but only when the
 * static route is declared — registered after, `$metadata` is swallowed by
 * `/:id` and answers a `404` for an entity named `$metadata`.
 */
export const agreementRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/agreement',
    guarded(Agreement, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? emptyPageRoute(Agreement)
        : listRoute(Agreement, settlementScopeFilter<Agreement>(scope));
    }),
  ),
  HttpRouter.get('/api/agreement/$metadata', entityMetadataRoute(Agreement)),
  HttpRouter.get(
    '/api/agreement/:id',
    guarded(Agreement, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? notFoundRoute(Agreement)
        : byIdRoute(
            Agreement,
            agreement => settlementInScope(scope, agreement),
            true,
          );
    }),
  ),
  HttpRouter.post(
    '/api/agreement',
    guarded(Agreement, 'write', () =>
      saveRoute(Agreement, { fromParams: false, validate: validateAgreement }),
    ),
  ),
  HttpRouter.put(
    '/api/agreement/:id',
    guarded(Agreement, 'write', () =>
      saveRoute(Agreement, { fromParams: true, validate: validateAgreement }),
    ),
  ),
);
