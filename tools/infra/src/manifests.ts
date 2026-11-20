/**
 * What the up command applies, in what order (ADR 0083 §5, #685).
 *
 * `kubectl apply -k infra/cluster` in one shot cannot work on an empty
 * cluster: a `RabbitmqCluster` is refused before its CRD is established, a
 * `Certificate` before cert-manager's webhook answers, and a pod that mounts
 * the cluster seed waits on a Secret only the identity provider can mint. So
 * the rendered tree is split into stages, applied one after another with a
 * wait between.
 *
 * kustomize's output is normalized — every document's top-level keys start in
 * column 0 and `metadata`'s own keys are indented two spaces — so each
 * document's kind, name and namespace are read with a line match rather than a
 * YAML parser the repository does not otherwise need.
 */
import { ADDRESS_PLACEHOLDER, DOMAIN_PLACEHOLDER } from './placeholders.js';

export interface Document {
  readonly kind: string;
  readonly name: string;
  readonly namespace: string | undefined;
  readonly text: string;
}

const metadataField = (text: string, field: string): string | undefined => {
  const block = /^metadata:\n((?: {2,}.*\n?)*)/m.exec(text)?.[1] ?? '';
  return new RegExp(`^ {2}${field}: ['"]?([^'"\\s]+)`, 'm').exec(block)?.[1];
};

/** One document per `---`, in order, the empty ones dropped. */
export const documents = (stream: string): Document[] =>
  stream
    .split(/^---\s*$/m)
    .map(text => text.trim())
    .filter(text => /^kind: /m.test(text))
    .map(text => ({
      kind: /^kind: (\S+)/m.exec(text)?.[1] ?? '',
      name: metadataField(text, 'name') ?? '',
      namespace: metadataField(text, 'namespace'),
      text: `${text}\n`,
    }));

export const stream = (docs: readonly Document[]): string =>
  docs.map(doc => doc.text).join('---\n');

/** The fleet's namespace (infra/cluster/platform/storage.yaml). */
export const NAMESPACE = 'r10c';

const EDGE_KINDS = new Set([
  'Gateway',
  'HTTPRoute',
  'ClientTrafficPolicy',
  'BackendTrafficPolicy',
  'Certificate',
  'ClusterIssuer',
]);

/** cert-manager's own resources: refused until its webhook answers. */
const ISSUED_KINDS = new Set(['Certificate', 'Issuer']);

export interface Stages {
  /** CRDs and namespaces: what every later document is checked against. */
  readonly definitions: readonly Document[];
  /** The vendored operators and every other cluster-wide object. */
  readonly operators: readonly Document[];
  /**
   * What an operator asks cert-manager for — the RabbitMQ operator's webhook
   * certificate and its issuer — applied once cert-manager's webhook is up,
   * and before that operator can start.
   */
  readonly issued: readonly Document[];
  /** RabbitMQ, Redis, Zitadel and its login, telemetry. */
  readonly platform: readonly Document[];
  /** The fleet's `Service`s: names Zitadel resolves when the seed registers its callbacks. */
  readonly fleetServices: readonly Document[];
  /** The fleet's workloads and the environment they share. */
  readonly fleet: readonly Document[];
  /** The Gateway, its routes and policies, the certificate and its issuer. */
  readonly edge: readonly Document[];
}

/**
 * Split the rendered tree. `fleetNames` is every name the fleet's generator
 * renders (`tools/cluster`), so a workload added to the register lands in the
 * fleet stage without this file knowing it.
 */
export const stages = (
  docs: readonly Document[],
  fleetNames: ReadonlySet<string>,
): Stages => {
  const definitions: Document[] = [];
  const operators: Document[] = [];
  const issued: Document[] = [];
  const platform: Document[] = [];
  const fleetServices: Document[] = [];
  const fleet: Document[] = [];
  const edge: Document[] = [];
  for (const doc of docs) {
    if (doc.kind === 'CustomResourceDefinition' || doc.kind === 'Namespace')
      definitions.push(doc);
    else if (doc.namespace !== NAMESPACE && ISSUED_KINDS.has(doc.kind))
      issued.push(doc);
    else if (EDGE_KINDS.has(doc.kind)) edge.push(doc);
    else if (doc.namespace !== NAMESPACE) operators.push(doc);
    else if (!fleetNames.has(doc.name)) platform.push(doc);
    else if (doc.kind === 'Service') fleetServices.push(doc);
    else fleet.push(doc);
  }
  return {
    definitions,
    operators,
    issued,
    platform,
    fleetServices,
    fleet,
    edge,
  };
};

export interface Substitutions {
  readonly domain: string;
  /** The edge's reserved address, or `undefined` where there is none (the lab). */
  readonly address: string | undefined;
}

/** Name the real domain and address where the manifests hold placeholders. */
export const substitute = (
  text: string,
  { domain, address }: Substitutions,
) => {
  const named = text.replaceAll(DOMAIN_PLACEHOLDER, domain);
  return address === undefined
    ? named
    : named.replaceAll(`'${ADDRESS_PLACEHOLDER}'`, `'${address}'`);
};
