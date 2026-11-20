/**
 * The cluster edge: the same route table as Envoy Gateway resources
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 * ingress-nginx is retired and is not an option.
 *
 * Nothing runs in a cluster yet. These are rendered and schema-validated in CI
 * so the cluster shape cannot drift from the local one before it is first
 * applied.
 */
import {
  ADDRESS_PLACEHOLDER,
  IDENTITY,
  IDLE_TIMEOUT_S,
  type Origin,
  ORIGINS,
  publicHost,
  REALTIME,
  upstreamOf,
} from './routes.js';
import type { Yaml } from './yaml.js';

export const GATEWAY = 'r10c-edge';
/**
 * The fleet's namespace (infra/cluster/platform/storage.yaml). A route's
 * backends are named without one, and `allowedRoutes` admits only routes in
 * the Gateway's own, so every namespaced edge resource sits in it.
 */
export const FLEET_NAMESPACE = 'r10c';
const GATEWAY_API = 'gateway.networking.k8s.io/v1';
const ENVOY_GATEWAY = 'gateway.envoyproxy.io/v1alpha1';
const seconds = (value: number): string => `${String(value)}s`;
const CERT_MANAGER = 'cert-manager.io/v1';

/** The one certificate every public hostname is served under, and its issuer. */
export const EDGE_TLS = 'edge-tls';
export const ISSUER = 'letsencrypt';

/** The plain-HTTP listener: a redirect to HTTPS, and the ACME challenge. */
const HTTP_LISTENER = 'http';
const listenerName = (host: string): string => `https-${host}`;

const gatewayClass: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'GatewayClass',
  metadata: { name: GATEWAY },
  spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
};

const gateway: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'Gateway',
  metadata: { name: GATEWAY, namespace: FLEET_NAMESPACE },
  spec: {
    gatewayClassName: GATEWAY,
    // The reserved address the domain's records point at, so a down and an
    // up never move the edge to a new one (ADR 0083 §5).
    addresses: [{ type: 'IPAddress', value: ADDRESS_PLACEHOLDER }],
    // One HTTPS listener per public hostname, each ending TLS with the same
    // certificate, and one plain listener for the redirect and the ACME
    // HTTP-01 challenge. The lab keeps its `300N` origins on the local Envoy
    // (envoy.ts); a cluster is reached by name on 443.
    listeners: [
      {
        name: HTTP_LISTENER,
        protocol: 'HTTP',
        port: 80,
        allowedRoutes: { namespaces: { from: 'Same' } },
      },
      ...[...ORIGINS.map(origin => origin.host), IDENTITY.host].map(host => ({
        name: listenerName(host),
        protocol: 'HTTPS',
        port: 443,
        hostname: publicHost(host),
        tls: {
          mode: 'Terminate',
          certificateRefs: [{ kind: 'Secret', name: EDGE_TLS }],
        },
        allowedRoutes: { namespaces: { from: 'Same' } },
      })),
    ],
  },
};

const backend = (name: string, port: number): Yaml => [{ name, port }];

/**
 * One route per origin. The stream rule carries `timeouts.request: 0s`, which
 * Gateway API defines as "no timeout": a stream is a request that never ends.
 */
const httpRoute = (origin: Origin): Yaml => ({
  apiVersion: GATEWAY_API,
  kind: 'HTTPRoute',
  metadata: { name: origin.app, namespace: FLEET_NAMESPACE },
  spec: {
    parentRefs: [{ name: GATEWAY, sectionName: listenerName(origin.host) }],
    rules: [
      {
        matches: [{ path: { type: 'Exact', value: REALTIME.stream } }],
        backendRefs: backend(REALTIME.app, REALTIME.port),
        timeouts: { request: '0s' },
      },
      {
        matches: [{ path: { type: 'PathPrefix', value: REALTIME.prefix } }],
        backendRefs: backend(REALTIME.app, REALTIME.port),
      },
      {
        matches: [{ path: { type: 'PathPrefix', value: '/' } }],
        backendRefs: backend(origin.app, upstreamOf(origin)),
      },
    ],
  },
});

/**
 * The identity provider's hostname (ADR 0018): the hosted login is a second
 * container under its own prefix, and Zitadel answers everything else —
 * the OIDC endpoints, the console, the APIs auth-service calls by its public
 * issuer.
 */
const identityRoute: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'HTTPRoute',
  metadata: { name: IDENTITY.app, namespace: FLEET_NAMESPACE },
  spec: {
    parentRefs: [{ name: GATEWAY, sectionName: listenerName(IDENTITY.host) }],
    rules: [
      {
        matches: [
          { path: { type: 'PathPrefix', value: IDENTITY.login.prefix } },
        ],
        backendRefs: backend(IDENTITY.login.app, IDENTITY.login.port),
      },
      {
        matches: [{ path: { type: 'PathPrefix', value: '/' } }],
        backendRefs: backend(IDENTITY.app, IDENTITY.port),
      },
    ],
  },
};

/** Plain HTTP answers nothing but a redirect; ACME's own route is more specific. */
const httpsRedirect: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'HTTPRoute',
  metadata: { name: 'https-redirect', namespace: FLEET_NAMESPACE },
  spec: {
    parentRefs: [{ name: GATEWAY, sectionName: HTTP_LISTENER }],
    rules: [
      {
        filters: [
          {
            type: 'RequestRedirect',
            requestRedirect: { scheme: 'https', statusCode: 301 },
          },
        ],
      },
    ],
  },
};

/**
 * The certificate, from Let's Encrypt over HTTP-01 through the plain listener
 * (cert-manager, vendored). The lab rehearsal swaps the issuer for a
 * self-signed one (`tools/infra`), since nothing on the internet can reach it.
 */
const issuer: Yaml = {
  apiVersion: CERT_MANAGER,
  kind: 'ClusterIssuer',
  metadata: { name: ISSUER },
  spec: {
    acme: {
      server: 'https://acme-v02.api.letsencrypt.org/directory',
      privateKeySecretRef: { name: `${ISSUER}-account` },
      solvers: [
        {
          http01: {
            gatewayHTTPRoute: {
              parentRefs: [
                {
                  name: GATEWAY,
                  namespace: FLEET_NAMESPACE,
                  kind: 'Gateway',
                  sectionName: HTTP_LISTENER,
                },
              ],
            },
          },
        },
      ],
    },
  },
};

const certificate: Yaml = {
  apiVersion: CERT_MANAGER,
  kind: 'Certificate',
  metadata: { name: EDGE_TLS, namespace: FLEET_NAMESPACE },
  spec: {
    secretName: EDGE_TLS,
    dnsNames: [...ORIGINS.map(origin => origin.host), IDENTITY.host].map(
      publicHost,
    ),
    issuerRef: { kind: 'ClusterIssuer', name: ISSUER },
  },
};

/**
 * HTTP/2 between the browser and the cluster edge, negotiated over ALPN once a
 * TLS listener carries the origins. Idle timeouts over twice the
 * heartbeat on the client side, as locally.
 */
const clientTrafficPolicy: Yaml = {
  apiVersion: ENVOY_GATEWAY,
  kind: 'ClientTrafficPolicy',
  metadata: { name: GATEWAY, namespace: FLEET_NAMESPACE },
  spec: {
    targetRefs: [
      { group: 'gateway.networking.k8s.io', kind: 'Gateway', name: GATEWAY },
    ],
    tls: { alpnProtocols: ['h2', 'http/1.1'] },
    http2: { maxConcurrentStreams: 100 },
    timeout: { http: { idleTimeout: seconds(IDLE_TIMEOUT_S) } },
  },
};

/** The upstream side: a held connection to a backend outlives the heartbeat. */
const backendTrafficPolicy: Yaml = {
  apiVersion: ENVOY_GATEWAY,
  kind: 'BackendTrafficPolicy',
  metadata: { name: GATEWAY, namespace: FLEET_NAMESPACE },
  spec: {
    targetRefs: [
      { group: 'gateway.networking.k8s.io', kind: 'Gateway', name: GATEWAY },
    ],
    timeout: {
      http: { connectionIdleTimeout: seconds(IDLE_TIMEOUT_S) },
    },
  },
};

/** File name under `infra/cluster/edge/` → its documents. */
/**
 * The directory's kustomization, so `kubectl apply -k infra/cluster` takes the
 * edge with the rest (ADR 0083 §7). It sets no namespace: kustomize cannot
 * tell that a `GatewayClass` is cluster-scoped and would stamp one on it, so
 * each namespaced resource above names `FLEET_NAMESPACE` itself.
 */
export const gatewayKustomization = (): Yaml => ({
  apiVersion: 'kustomize.config.k8s.io/v1beta1',
  kind: 'Kustomization',
  resources: Object.keys(gatewayManifests()),
});

export const gatewayManifests = (): Readonly<
  Record<string, readonly Yaml[]>
> => ({
  'gateway.yaml': [gatewayClass, gateway],
  'httproutes.yaml': [...ORIGINS.map(httpRoute), identityRoute, httpsRedirect],
  'tls.yaml': [issuer, certificate],
  'traffic-policies.yaml': [clientTrafficPolicy, backendTrafficPolicy],
});
