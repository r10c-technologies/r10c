/**
 * The `auth` slice's shell: the sign-in and account routes, and the
 * composition that binds its cells to the fleet — the control-plane store,
 * Redis sessions, Zitadel, the relay, the organization rebuild walk and the
 * provider lifecycle reconciler. auth-service only mounts it, handing in its
 * seed (ADR 0064).
 */
export {
  AUTH_SLICE,
  authComposition,
  type AuthShellOptions,
  makeAppLayer,
} from './app-layer.js';
export {
  LifecycleSweepIntervalMs,
  reconcileOnce,
  reconcilePass,
  startLifecycleReconciler,
} from './lifecycle-reconciler.js';
export {
  rebuildAndReport,
  startOrganizationRebuild,
} from './organization-rebuild.js';
export { router } from './router.js';
export {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './session-policy.js';
export {
  AuthnHostLayer,
  PROVIDER,
  ZitadelProviderPortsLayer,
} from './zitadel-ports.js';
