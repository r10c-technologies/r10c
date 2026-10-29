import { Invalid } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_ANNOUNCED,
  organizationAnnouncedEvent,
  type OrganizationAnnouncement,
  organizationEventId,
  readOrganizationAnnouncement,
} from './organization-announcement.js';

const ANNOUNCEMENT: OrganizationAnnouncement = {
  organizationId: 'demo-organization',
  displayName: 'Demo Vendor',
  announcedAt: '2026-10-23T10:00:00.000Z',
};

const read = (data: unknown) =>
  Effect.runSyncExit(readOrganizationAnnouncement(data));

const failureOf = (data: unknown): string => {
  const exit = read(data);
  if (Exit.isSuccess(exit)) throw new Error('expected the decode to fail');
  // A typed `invalid` failure, so the bus quarantines it at once; its detail
  // names what was wrong.
  const failure = Effect.runSync(
    Effect.flip(readOrganizationAnnouncement(data)),
  );
  if (!(failure instanceof Invalid)) {
    throw new Error('expected a typed `invalid` failure');
  }
  return failure.errors.map(error => error.detail).join(' ');
};

describe('organizationEventId', () => {
  it('keys on the organization and the moment, so a rename is its own message', () => {
    expect(organizationEventId(ANNOUNCEMENT)).toBe(
      'demo-organization:2026-10-23T10:00:00.000Z',
    );
    expect(organizationEventId(ANNOUNCEMENT)).not.toBe(
      organizationEventId({
        ...ANNOUNCEMENT,
        announcedAt: '2026-10-24T10:00:00.000Z',
      }),
    );
  });

  it('does not move with the name, so a rebuild re-states the same message', () => {
    expect(organizationEventId(ANNOUNCEMENT)).toBe(
      organizationEventId({ ...ANNOUNCEMENT, displayName: 'Renamed' }),
    );
  });
});

describe('organizationAnnouncedEvent', () => {
  it('builds a routable message stamped with the slice and the write moment', () => {
    const event = organizationAnnouncedEvent(ANNOUNCEMENT, 'auth');

    expect(event).toEqual({
      name: ORGANIZATION_ANNOUNCED,
      id: organizationEventId(ANNOUNCEMENT),
      source: 'auth',
      at: ANNOUNCEMENT.announcedAt,
      correlationId: 'demo-organization',
      aggregate: { type: 'organization', id: 'demo-organization' },
      version: Date.parse(ANNOUNCEMENT.announcedAt),
      data: ANNOUNCEMENT,
    });
  });
});

describe('readOrganizationAnnouncement', () => {
  it('reads a well-formed payload back, dropping undeclared members', () => {
    expect(
      Effect.runSync(
        readOrganizationAnnouncement({ ...ANNOUNCEMENT, slug: 'demo-vendor' }),
      ),
    ).toEqual(ANNOUNCEMENT);
  });

  it.each([null, 'text', 7])('rejects %s, which is not an object', value => {
    expect(failureOf(value)).toContain('Expected object');
  });

  it('names every missing or blank member at once', () => {
    const failure = failureOf({ displayName: '  ' });

    expect(failure).toContain('organizationId');
    expect(failure).toContain('displayName');
    expect(failure).toContain('announcedAt');
  });

  it('rejects a stamp that does not parse, since it cannot be ordered', () => {
    expect(failureOf({ ...ANNOUNCEMENT, announcedAt: 'yesterday' })).toContain(
      'announcedAt',
    );
  });
});
