/**
 * The local edge: one Envoy, run in a container by `serve.sh`, owning 3000 and
 * 3001 on the host and speaking plain HTTP/1.1
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 */
import {
  IDLE_TIMEOUT_S,
  LOCAL_UPSTREAM_HOST,
  type Origin,
  ORIGINS,
  REALTIME,
  upstreamOf,
} from './routes.js';
import type { Yaml } from './yaml.js';

const TYPE = 'type.googleapis.com/envoy.extensions';
const seconds = (value: number): string => `${String(value)}s`;

/**
 * One line per request. `%REQ_WITHOUT_QUERY(:PATH)%` on **every** route,
 * because the stream's URL carries flow capabilities and a capability in an
 * access log is a credential in an access log. Redacting everywhere rather than
 * on the stream route alone means no new route can forget to.
 */
export const ACCESS_LOG_FORMAT =
  '[%START_TIME%] "%REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %PROTOCOL%" ' +
  '%RESPONSE_CODE% %RESPONSE_FLAGS% %DURATION%ms -> %UPSTREAM_CLUSTER%\n';

export const nextCluster = (origin: Origin): string =>
  `next_${String(upstreamOf(origin))}`;
export const REALTIME_CLUSTER = 'realtime';

const cluster = (name: string, port: number): Yaml => ({
  name,
  type: 'LOGICAL_DNS',
  dns_lookup_family: 'V4_ONLY',
  connect_timeout: '1s',
  load_assignment: {
    cluster_name: name,
    endpoints: [
      {
        lb_endpoints: [
          {
            endpoint: {
              address: {
                socket_address: {
                  address: LOCAL_UPSTREAM_HOST,
                  port_value: port,
                },
              },
            },
          },
        ],
      },
    ],
  },
  typed_extension_protocol_options: {
    'envoy.extensions.upstreams.http.v3.HttpProtocolOptions': {
      '@type': `${TYPE}.upstreams.http.v3.HttpProtocolOptions`,
      common_http_protocol_options: { idle_timeout: seconds(IDLE_TIMEOUT_S) },
      explicit_http_config: { http_protocol_options: {} },
    },
  },
});

/**
 * The routes of one origin, most specific first.
 *
 * - The stream: no request timeout (`0s` disables it) and an idle timeout over
 *   twice the heartbeat, so a quiet stream is never closed by a hop.
 * - The rest of the realtime prefix: the flow catch-up reads, ordinary requests.
 * - Next. Also `0s`: Envoy's default is 15 s, which a cold Turbopack compile
 *   exceeds, and a streamed RSC response is open for as long as its slowest
 *   Suspense boundary.
 */
const routes = (origin: Origin): Yaml => [
  {
    name: 'realtime-stream',
    match: { path: REALTIME.stream },
    route: {
      cluster: REALTIME_CLUSTER,
      timeout: '0s',
      idle_timeout: seconds(IDLE_TIMEOUT_S),
    },
  },
  {
    name: 'realtime',
    match: { path_separated_prefix: REALTIME.prefix },
    route: { cluster: REALTIME_CLUSTER },
  },
  {
    name: 'next',
    match: { prefix: '/' },
    route: {
      cluster: nextCluster(origin),
      timeout: '0s',
      idle_timeout: seconds(IDLE_TIMEOUT_S),
    },
  },
];

const listener = (origin: Origin): Yaml => {
  const name = `origin_${String(origin.origin)}`;
  return {
    name,
    address: {
      socket_address: { address: '0.0.0.0', port_value: origin.origin },
    },
    filter_chains: [
      {
        filters: [
          {
            name: 'envoy.filters.network.http_connection_manager',
            typed_config: {
              '@type': `${TYPE}.filters.network.http_connection_manager.v3.HttpConnectionManager`,
              stat_prefix: name,
              // Plain HTTP/1.1 locally; HTTP/2 is the cluster edge's job, and
              // one EventSource per tab keeps a tab inside the connection budget.
              codec_type: 'HTTP1',
              stream_idle_timeout: seconds(IDLE_TIMEOUT_S),
              common_http_protocol_options: {
                idle_timeout: seconds(IDLE_TIMEOUT_S),
              },
              // Turbopack's HMR socket (`/_next/hmr`) is a WebSocket;
              // without the upgrade the dev client reloads in a loop.
              upgrade_configs: [{ upgrade_type: 'websocket' }],
              access_log: [
                {
                  name: 'envoy.access_loggers.stdout',
                  typed_config: {
                    '@type': `${TYPE}.access_loggers.stream.v3.StdoutAccessLog`,
                    log_format: {
                      text_format_source: { inline_string: ACCESS_LOG_FORMAT },
                      // `REQ_WITHOUT_QUERY` is an extension, not a built-in
                      // operator: without this the config does not load.
                      formatters: [
                        {
                          name: 'envoy.formatter.req_without_query',
                          typed_config: {
                            '@type': `${TYPE}.formatter.req_without_query.v3.ReqWithoutQuery`,
                          },
                        },
                      ],
                    },
                  },
                },
              ],
              http_filters: [
                {
                  name: 'envoy.filters.http.router',
                  typed_config: {
                    '@type': `${TYPE}.filters.http.router.v3.Router`,
                  },
                },
              ],
              // No host rewrite: Next and the auth cookies see `localhost:300N`,
              // the origin the browser named.
              route_config: {
                name,
                virtual_hosts: [
                  { name, domains: ['*'], routes: routes(origin) },
                ],
              },
            },
          },
        ],
      },
    ],
  };
};

/** The whole local config, as data. */
export const envoyConfig = (): Yaml => ({
  // Inside the container only; `serve.sh` publishes the origins and nothing
  // else.
  admin: {
    address: { socket_address: { address: '127.0.0.1', port_value: 9901 } },
  },
  static_resources: {
    listeners: ORIGINS.map(listener),
    clusters: [
      ...ORIGINS.map(origin =>
        cluster(nextCluster(origin), upstreamOf(origin)),
      ),
      cluster(REALTIME_CLUSTER, REALTIME.port),
    ],
  },
});
