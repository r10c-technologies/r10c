import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_WORKSPACE_SCOPE,
  workspaceScopeKey,
} from './workspace-scope.js';

describe('workspaceScopeKey', () => {
  it('keys a workspace by its user and the organization it is acting for', () => {
    expect(workspaceScopeKey({ userId: 'u-1', organizationId: 'org-1' })).toBe(
      'u-1:org-1',
    );
  });

  // A party may hold several memberships, and a record id is tenant-scoped, so a
  // draft carried across a switch would be submitted into the wrong tenant.
  it('separates one user’s two organizations', () => {
    expect(
      workspaceScopeKey({ userId: 'u-1', organizationId: 'org-1' }),
    ).not.toBe(workspaceScopeKey({ userId: 'u-1', organizationId: 'org-2' }));
  });

  it('separates two users in the same organization', () => {
    expect(
      workspaceScopeKey({ userId: 'u-1', organizationId: 'org-1' }),
    ).not.toBe(workspaceScopeKey({ userId: 'u-2', organizationId: 'org-1' }));
  });

  // A buyer or an operator holds no tenant scope at all — a real scope of its
  // own, spelled out so it cannot collide with an organization literally named
  // by the placeholder.
  it('gives a session with no organization a scope rather than a blank', () => {
    expect(workspaceScopeKey({ userId: 'u-1' })).toBe('u-1:-');
    expect(workspaceScopeKey({ userId: 'u-1' })).not.toBe(
      workspaceScopeKey({ userId: 'u-1', organizationId: '' }),
    );
  });

  it('never collides with the unidentified visitor’s scope', () => {
    expect(workspaceScopeKey({ userId: 'u-1' })).not.toBe(
      ANONYMOUS_WORKSPACE_SCOPE,
    );
  });
});
