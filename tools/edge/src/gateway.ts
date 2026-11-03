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
  IDLE_TIMEOUT_S,
  type Origin,
  ORIGINS,
  REALTIME,
  upstreamOf,
} from './routes.js';
import type { Yaml } from './yaml.js';

export const GATEWAY = 'r10c-edge';
const GATEWAY_API = 'gateway.networking.k8s.io/v1';
const ENVOY_GATEWAY = 'gateway.envoyproxy.io/v1alpha1';
const seconds = (value: number): string => `${String(value)}s`;
const listenerName = (origin: Origin): string =>
  `origin-${String(origin.origin)}`;

const gatewayClass: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'GatewayClass',
  metadata: { name: GATEWAY },
  spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
};

const gateway: Yaml = {
  apiVersion: GATEWAY_API,
  kind: 'Gateway',
  metadata: { name: GATEWAY },
  spec: {
    gatewayClassName: GATEWAY,
    listeners: ORIGINS.map(origin => ({
      name: listenerName(origin),
      protocol: 'HTTP',
      port: origin.origin,
      allowedRoutes: { namespaces: { from: 'Same' } },
    })),
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
  metadata: { name: origin.app },
  spec: {
    parentRefs: [{ name: GATEWAY, sectionName: listenerName(origin) }],
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
 * HTTP/2 between the browser and the cluster edge, negotiated over ALPN once a
 * TLS listener carries the origins. Idle timeouts over twice the
 * heartbeat on the client side, as locally.
 */
const clientTrafficPolicy: Yaml = {
  apiVersion: ENVOY_GATEWAY,
  kind: 'ClientTrafficPolicy',
  metadata: { name: GATEWAY },
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
  metadata: { name: GATEWAY },
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
export const gatewayManifests = (): Readonly<
  Record<string, readonly Yaml[]>
> => ({
  'gateway.yaml': [gatewayClass, gateway],
  'httproutes.yaml': ORIGINS.map(httpRoute),
  'traffic-policies.yaml': [clientTrafficPolicy, backendTrafficPolicy],
});
