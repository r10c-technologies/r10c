/**
 * The fleet as cluster workloads (ADR 0083, #682): one `Deployment` and one
 * `Service` per process, rendered from the two lists that already name every
 * process and its port — `FLEET` in `tools/slices` (the services, checked
 * against the slice register) and `ORIGINS` in `tools/edge` (the Next apps,
 * at the origin + 200) — so a service added to the register is a workload
 * here without anyone writing YAML for it.
 *
 * Both lists are handed in rather than imported: a tool may not import
 * another tool's source (`@nx/enforce-module-boundaries`), so the composition
 * happens where the repository already composes tools — a root script
 * (`tools/generate-cluster.mjs`, as `sync-docs.mjs` does) and the specs.
 *
 * Nothing renders a secret value. A pod names the Secrets it reads, and their
 * values have a source of their own (#683); the addresses only the cloud knows
 * (the database host, the public domain) are #685's `cloud-endpoints`.
 */

/** Plain data a YAML emitter can write: the shape `tools/edge` emits. */
export type Yaml =
  | string
  | number
  | boolean
  | readonly Yaml[]
  | { readonly [key: string]: Yaml };

/** What the fleet is rendered from. */
export interface FleetInputs {
  /** Every service and the port it binds: `FLEET` in `tools/slices`. */
  readonly services: readonly {
    readonly project: string;
    readonly port: number;
  }[];
  /** Every Next app and the port it listens on, the origin + 200. */
  readonly apps: readonly { readonly project: string; readonly port: number }[];
}

/** The tag `pnpm nx run <project>:container` builds; #685 rewrites it on push. */
export const IMAGE_TAG = 'local';
export const imageOf = (project: string): string =>
  `r10c/${project}:${IMAGE_TAG}`;

/** The fleet's namespace (infra/cluster/platform/storage.yaml). */
export const FLEET_NAMESPACE = 'r10c';

/** Every pod reads these: where config-service is, and the token it checks. */
export const FLEET_ENV = 'fleet-env';
export const FLEET_TOKEN = 'fleet-token';

/** config-service's own address, under the name `utils-ts-fleet` reads. */
const CONFIG_SERVICE = 'config-service';

/** A service's in-cluster address, under the name a Next shell reads it by. */
export const serviceUrlVariable = (project: string): string =>
  `${project
    .replace(/-service$/, '')
    .replaceAll('-', '_')
    .toUpperCase()}_SERVICE_URL`;

const configServicePort = ({ services }: FleetInputs): number => {
  const entry = services.find(({ project }) => project === CONFIG_SERVICE);
  if (!entry) throw new Error(`${CONFIG_SERVICE} is not among the services`);
  return entry.port;
};

/**
 * What one process needs beyond the shared shape. Every number here is a
 * starting point the lab's measured requests sized (#678), not a tuning.
 */
interface Workload {
  readonly name: string;
  readonly image: string;
  readonly port: number;
  readonly replicas: number;
  /** Seconds the pod is held after its endpoint leaves the Service. */
  readonly preStop: number;
  readonly grace: number;
  readonly requests: { readonly cpu: string; readonly memory: string };
  readonly limits: { readonly cpu: string; readonly memory: string };
  readonly env: readonly Yaml[];
  readonly extraPorts: readonly Yaml[];
  readonly command?: readonly string[];
  /** A process with no HTTP is probed on the socket it does open. */
  readonly probe: 'http' | { readonly tcp: string };
  /** Whether a `Service` fronts it: a runner is reached by address, not by name. */
  readonly service: boolean;
}

const SERVICE_RESOURCES = {
  requests: { cpu: '100m', memory: '128Mi' },
  limits: { cpu: '500m', memory: '512Mi' },
} as const;

const APP_RESOURCES = {
  requests: { cpu: '200m', memory: '256Mi' },
  limits: { cpu: '1', memory: '768Mi' },
} as const;

/** The pod's own address, for a runner that registers where it can be reached. */
const POD_IP: Yaml = {
  name: 'WORKFLOW_RUNNER_HOST',
  valueFrom: { fieldRef: { fieldPath: 'status.podIP' } },
};

/** The flow engine's runner port: the service port + 31000 + 1000 × replica (ADR 0066). */
const runnerPort = (servicePort: number, replica: number): number =>
  servicePort + 31_000 + 1_000 * replica;

const service = (project: string, port: number): Workload => {
  const base: Workload = {
    name: project,
    image: imageOf(project),
    port,
    replicas: 1,
    // A service's readiness turns false on SIGTERM; the hold lets the
    // endpoint leave the Service before the process stops taking requests.
    preStop: 5,
    grace: 30,
    ...SERVICE_RESOURCES,
    env: [],
    extraPorts: [],
    probe: 'http',
    service: true,
  };
  switch (project) {
    case 'realtime-service': {
      // The drain is three parts, in order (ADR 0072). `preStop` holds the
      // pod while the endpoint leaves the Service, so no new stream lands on
      // it; SIGTERM then closes the SSE adapter's scope, which sends every
      // open stream a fresh randomized `retry:` and ends it inside its 5 s
      // drain window; and the grace period outlasts both, so the kubelet never
      // SIGKILLs a pod still draining. A rolling restart therefore spreads its
      // reconnects instead of landing them on one replica at once. Two
      // replicas, because each holds different connections and a broadcast
      // subscription per replica is the design.
      return { ...base, replicas: 2, preStop: 10, grace: 30 };
    }
    case CONFIG_SERVICE: {
      // The one process that reads its database from the environment: every
      // other service asks it for theirs.
      return {
        ...base,
        env: [
          {
            name: 'CONFIG_PG_URL',
            valueFrom: {
              secretKeyRef: { name: 'config-service-database', key: 'url' },
            },
          },
        ],
      };
    }
    case 'transaction-service': {
      // Replica 0 of the flow engine serves HTTP and runs a runner beside it,
      // registered at the pod's own address so the other runner can reach it.
      return {
        ...base,
        env: [POD_IP],
        extraPorts: [{ name: 'runner', containerPort: runnerPort(port, 0) }],
      };
    }
    default: {
      return base;
    }
  }
};

/**
 * transaction-service's runner-only replica, from the same image: no HTTP,
 * its shards assigned in the `workflow` store beside replica 0's (ADR 0066).
 * Its runner socket is the one thing it listens on, so that is what its
 * probes ask.
 */
const transactionRunner = (port: number): Workload => ({
  name: 'transaction-runner',
  image: imageOf('transaction-service'),
  port: runnerPort(port, 1),
  replicas: 1,
  preStop: 0,
  grace: 30,
  ...SERVICE_RESOURCES,
  command: ['node', '--enable-source-maps', 'runner.js'],
  env: [
    { name: 'PORT', value: String(port) },
    { name: 'WORKFLOW_REPLICA', value: '1' },
    POD_IP,
  ],
  extraPorts: [],
  probe: { tcp: 'runner' },
  service: false,
});

const app = (project: string, port: number): Workload => ({
  name: project,
  image: imageOf(project),
  port,
  replicas: 1,
  preStop: 5,
  grace: 30,
  ...APP_RESOURCES,
  env: [],
  extraPorts: [],
  probe: 'http',
  service: true,
});

/** Every workload the fleet runs, in a stable order. */
export const workloads = (inputs: FleetInputs): readonly Workload[] => [
  ...inputs.services.flatMap(({ project, port }) =>
    project === 'transaction-service'
      ? [service(project, port), transactionRunner(port)]
      : [service(project, port)],
  ),
  ...inputs.apps.map(({ project, port }) => app(project, port)),
];

const labels = (name: string): Yaml => ({ app: name });

const probes = (workload: Workload): Yaml => {
  if (workload.probe !== 'http') {
    const socket = { tcpSocket: { port: workload.probe.tcp } };
    return {
      livenessProbe: { ...socket, periodSeconds: 10, failureThreshold: 3 },
      readinessProbe: { ...socket, periodSeconds: 5, failureThreshold: 2 },
    };
  }
  // Distinct on purpose: liveness asks "is the process wedged?" and restarts
  // it; readiness asks "can it serve?" and only takes it out of the Service.
  // A broker outage must fail the second, never the first, or every replica
  // restarts at once.
  return {
    startupProbe: {
      httpGet: { path: '/api/health/live', port: 'http' },
      periodSeconds: 2,
      failureThreshold: 60,
    },
    livenessProbe: {
      httpGet: { path: '/api/health/live', port: 'http' },
      periodSeconds: 10,
      failureThreshold: 3,
    },
    readinessProbe: {
      httpGet: { path: '/api/health/ready', port: 'http' },
      periodSeconds: 5,
      failureThreshold: 2,
    },
  };
};

const deployment = (workload: Workload): Yaml => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: workload.name, labels: labels(workload.name) },
  spec: {
    replicas: workload.replicas,
    selector: { matchLabels: labels(workload.name) },
    template: {
      metadata: { labels: labels(workload.name) },
      spec: {
        terminationGracePeriodSeconds: workload.grace,
        securityContext: {
          runAsNonRoot: true,
          seccompProfile: { type: 'RuntimeDefault' },
        },
        containers: [
          {
            name: workload.name,
            image: workload.image,
            imagePullPolicy: 'IfNotPresent',
            ...(workload.command && { command: [...workload.command] }),
            ports: [
              {
                name: workload.probe === 'http' ? 'http' : 'runner',
                containerPort: workload.port,
              },
              ...workload.extraPorts,
            ],
            env: [
              ...(workload.command
                ? []
                : [{ name: 'PORT', value: String(workload.port) }]),
              {
                name: 'CONFIG_SERVICE_TOKEN',
                valueFrom: {
                  secretKeyRef: { name: FLEET_TOKEN, key: 'token' },
                },
              },
              ...workload.env,
            ],
            envFrom: [{ configMapRef: { name: FLEET_ENV } }],
            ...(workload.preStop > 0 && {
              lifecycle: { preStop: { sleep: { seconds: workload.preStop } } },
            }),
            ...(probes(workload) as Record<string, Yaml>),
            resources: {
              requests: { ...workload.requests },
              limits: { ...workload.limits },
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
          },
        ],
      },
    },
  },
});

const serviceOf = (workload: Workload): Yaml => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: workload.name, labels: labels(workload.name) },
  spec: {
    selector: labels(workload.name),
    ports: [{ name: 'http', port: workload.port, targetPort: 'http' }],
  },
});

/**
 * The shared environment: where config-service answers, and every service's
 * address under the name the Next shells read (`*_SERVICE_URL`, which default
 * to `localhost` in the lab).
 */
export const fleetEnv = (inputs: FleetInputs): Yaml => ({
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: { name: FLEET_ENV },
  data: {
    NODE_ENV: 'production',
    CONFIG_API_URL: `http://${CONFIG_SERVICE}:${String(configServicePort(inputs))}`,
    ...Object.fromEntries(
      inputs.services
        .filter(({ project }) => project !== CONFIG_SERVICE)
        .map(({ project, port }) => [
          serviceUrlVariable(project),
          `http://${project}:${String(port)}`,
        ]),
    ),
  },
});

/** File name → the documents in it, under `infra/cluster/fleet/`. */
export const fleetManifests = (
  inputs: FleetInputs,
): Readonly<Record<string, readonly Yaml[]>> => {
  const files: Record<string, readonly Yaml[]> = {
    'fleet-env.yaml': [fleetEnv(inputs)],
  };
  for (const workload of workloads(inputs)) {
    files[`${workload.name}.yaml`] = workload.service
      ? [deployment(workload), serviceOf(workload)]
      : [deployment(workload)];
  }
  return files;
};

/** The fleet's own kustomization, listing every rendered file. */
export const fleetKustomization = (inputs: FleetInputs): Yaml => ({
  apiVersion: 'kustomize.config.k8s.io/v1beta1',
  kind: 'Kustomization',
  // Every kind here is one kustomize knows to be namespaced, so the
  // transformer is safe (the edge's `GatewayClass` is why its own is not).
  namespace: FLEET_NAMESPACE,
  resources: Object.keys(fleetManifests(inputs)),
});
