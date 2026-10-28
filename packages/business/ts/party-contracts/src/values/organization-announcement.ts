import {
  type DomainEvent,
  EntifixBuildError,
  type TransitionalFailure,
} from '@entifix/core';
import { Effect } from 'effect';

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
): DomainEvent<OrganizationAnnouncement> => ({
  name: ORGANIZATION_ANNOUNCED,
  id: organizationEventId(announcement),
  source,
  at: announcement.announcedAt,
  correlationId: announcement.organizationId,
  data: announcement,
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Reads a bus payload back into an {@link OrganizationAnnouncement}.
 *
 * ⚠️ **It rejects rather than coerces**, which classifies the message poison
 * (ADR 0030). Every member is required here, unlike a publication's optional
 * merchandising: an announcement with no name says nothing, and one with no
 * stamp cannot be ordered against the next.
 */
export const readOrganizationAnnouncement = (
  data: unknown,
): Effect.Effect<OrganizationAnnouncement, TransitionalFailure> =>
  Effect.gen(function* () {
    if (data === null || typeof data !== 'object') {
      return yield* Effect.fail(
        new EntifixBuildError(
          'organization announcement payload is not an object',
          undefined,
          { data },
        ),
      );
    }

    const raw = data as Record<string, unknown>;
    const missing = ['organizationId', 'displayName', 'announcedAt'].filter(
      member => !isNonEmptyString(raw[member]),
    );
    // A stamp that does not parse cannot be compared, and a guard comparing
    // `NaN` lets every message through.
    if (
      !missing.includes('announcedAt') &&
      Number.isNaN(Date.parse(raw['announcedAt'] as string))
    ) {
      missing.push('announcedAt');
    }

    if (missing.length > 0) {
      return yield* Effect.fail(
        new EntifixBuildError(
          `organization announcement payload is missing or malformed (${missing.join(', ')})`,
          undefined,
          { missing, data },
        ),
      );
    }

    return {
      organizationId: raw['organizationId'] as string,
      displayName: raw['displayName'] as string,
      announcedAt: raw['announcedAt'] as string,
    };
  });
