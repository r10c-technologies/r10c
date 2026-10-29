import {
  type AggregateRef,
  type DomainEvent,
  Invalid,
  openStruct,
  registerEvent,
  type TransitionalFailure,
} from '@entifix/core';
import { Effect, Schema } from 'effect';

/**
 * A payload this process cannot read, as a typed `invalid` failure. Business
 * family, so the bus quarantines it at once rather than redelivering a message
 * no retry will fix (ADR 0030, ADR 0064) — the legacy `EntifixBuildError` it
 * replaces is not a typed failure, and since entifix 0.10.0 the adapter reads
 * anything untyped as transient.
 */
const invalidPayload = (detail: string) =>
  new Invalid({ errors: [{ pointer: '/data', detail, code: 'malformed' }] });

/**
 * An organization's public face changed, or is being re-stated. Routing key
 * and register name.
 *
 * One name for a create, a rename and a rebuild alike: the consumer replaces
 * what it holds with what it is told, so "first time" and "again" are the same
 * operation, ordered by {@link OrganizationAnnouncement.announcedAt}.
 */
export const ORGANIZATION_ANNOUNCED = 'organization.announced';

/** What one announcement says about one organization. */
export interface OrganizationAnnouncement {
  /** `Organization.id`, which is the `vendorId` a publication carries. */
  readonly organizationId: string;
  /** The name a buyer sees on a seller line. `Organization.name` today. */
  readonly displayName: string;
  /**
   * ISO-8601. When the organization was last written, and therefore the
   * **ordering key** the projector's write guard compares.
   *
   * ⚠️ **The moment of the write, never the moment of the announcement.** A
   * rebuild walk re-announces every organization at its stored stamp, so an
   * old name re-stated during a rebuild cannot outrank a rename that landed
   * while the walk ran (ADR 0061, the same rule ADR 0050 gives a publication).
   */
  readonly announcedAt: string;
}

/**
 * The message id, and therefore the **deduplication key**:
 * `<organizationId>:<announcedAt>`.
 *
 * Keyed on the moment as well as the subject, because one organization is
 * announced many times — a rename is its own message, while a rebuild that
 * re-states an unchanged organization reproduces the original id exactly and
 * the outbox's unique index recognises it.
 */
export const organizationEventId = (
  announcement: OrganizationAnnouncement,
): string => `${announcement.organizationId}:${announcement.announcedAt}`;

/**
 * Wraps an announcement as a routable message from `source` — the emitting
 * **slice** (`auth`), never the deployment (ADR 0029).
 */
export const organizationAnnouncedEvent = (
  announcement: OrganizationAnnouncement,
  source: string,
): DomainEvent<OrganizationAnnouncement> & {
  aggregate: AggregateRef;
  version: number;
} => ({
  name: ORGANIZATION_ANNOUNCED,
  id: organizationEventId(announcement),
  source,
  at: announcement.announcedAt,
  correlationId: announcement.organizationId,
  // The organization is the aggregate and its announcement stamp the version,
  // so a rebuild re-stating it at its own stamp is the same version, not a
  // newer one.
  aggregate: { type: 'organization', id: announcement.organizationId },
  version: Date.parse(announcement.announcedAt),
  data: announcement,
});

/** A string with something in it besides whitespace. */
const Filled = Schema.String.check(Schema.isPattern(/\S/));

/**
 * What an announcement's `data` must hold. A stamp that does not parse cannot
 * be compared, and a guard comparing `NaN` lets every message through, so the
 * stamp must parse as a date.
 */
export const OrganizationAnnouncementSchema = openStruct({
  organizationId: Filled,
  displayName: Filled,
  announcedAt: Filled.check(
    Schema.makeFilter(value => !Number.isNaN(Date.parse(value))),
  ),
});

// Audience-free: an announcement is folded into the published-vendor
// projection, which any storefront visitor may read, and no person is ever
// sent it.
registerEvent(ORGANIZATION_ANNOUNCED, OrganizationAnnouncementSchema, {
  versioned: true,
  audience: 'none',
});

/** Reads an announcement's `data` through the registered schema. */
export const readOrganizationAnnouncement = (
  data: unknown,
): Effect.Effect<OrganizationAnnouncement, TransitionalFailure> =>
  Effect.map(
    Schema.decodeUnknownEffect(OrganizationAnnouncementSchema)(data, {
      errors: 'all',
    }).pipe(
      Effect.mapError(error =>
        invalidPayload(
          `organization announcement payload is malformed: ${error.message}`,
        ),
      ),
    ),
    ({ organizationId, displayName, announcedAt }) => ({
      organizationId,
      displayName,
      announcedAt,
    }),
  );
