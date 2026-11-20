/**
 * The kustomization the up command renders the cluster through: the
 * committed tree, plus what one target needs that the tree cannot say.
 *
 * - **gcp** only renames the images: each `r10c/<project>:local` becomes the
 *   registry's, tagged with the commit it was built from.
 * - **lab** is the same tree on minikube (the rehearsal #685 is tested
 *   against): minikube's own volume provisioner instead of the GKE disk,
 *   a self-signed issuer since nothing on the internet can reach it, no
 *   reserved address, plain Postgres connections to the lab's own server
 *   under names that cannot collide with the lab Zitadel's, a denylist that
 *   allows minikube's Service range, and smaller requests, because one 8 GiB
 *   node carries the lab's datastores as well.
 *
 * Generated, never committed: it lives under `infra/.overlay/<target>/`.
 */
export type Target = 'lab' | 'gcp';

export interface Image {
  readonly name: string;
  readonly newName: string;
  readonly newTag: string;
}

/** The upstream default denylist (infra/local/zitadel/config.yaml), `10.0.0.0/8` included. */
const DEFAULT_DENY_LIST = [
  'localhost',
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '198.18.0.0/15',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
] as const;

const toInt = (address: string): number =>
  address.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0);
const toAddress = (value: number): string =>
  [24, 16, 8, 0]
    .map(shift => String(Math.floor(value / 2 ** shift) % 256))
    .join('.');

const parse = (cidr: string): [number, number] => {
  const [address = '', bits = '32'] = cidr.split('/');
  return [toInt(address), Number(bits)];
};

/** `parent` with `child` cut out of it, as the fewest CIDRs that cover the rest. */
export const subtract = (parent: string, child: string): string[] => {
  const [base, bits] = parse(parent);
  const [inner, innerBits] = parse(child);
  const size = 2 ** (32 - bits);
  if (innerBits < bits || inner < base || inner >= base + size) return [parent];
  if (innerBits === bits) return [];
  const half = size / 2;
  return [
    ...subtract(`${toAddress(base)}/${String(bits + 1)}`, child),
    ...subtract(`${toAddress(base + half)}/${String(bits + 1)}`, child),
  ];
};

/** The default denylist with one private range let through: the cluster's Services. */
export const zitadelDenyList = (serviceRange: string): string[] =>
  DEFAULT_DENY_LIST.flatMap(entry =>
    entry === '10.0.0.0/8' ? subtract(entry, serviceRange) : [entry],
  );

/** The GKE cluster's Service range (infra/gcp/network.tf) and minikube's default. */
export const GKE_SERVICE_RANGE = '10.30.0.0/20';
export const MINIKUBE_SERVICE_RANGE = '10.96.0.0/12';

/** What the lab's Zitadel is called in the lab's Postgres. */
export const LAB_ZITADEL_DATABASE = 'zitadel_rehearsal';

const indent = (text: string, by: number): string =>
  text
    .split('\n')
    .map(line => (line === '' ? line : ' '.repeat(by) + line))
    .join('\n');

const json6902 = (
  target: string,
  operations: readonly Record<string, unknown>[],
): string =>
  [
    '  - target:',
    indent(target, 6),
    '    patch: |-',
    indent(operations.map(op => `- ${JSON.stringify(op)}`).join('\n'), 6),
  ].join('\n');

const strategic = (patch: string): string =>
  ['  - patch: |-', indent(patch, 6)].join('\n');

const labPatches = (): string[] => [
  json6902('kind: StorageClass\nname: retained', [
    { op: 'replace', path: '/provisioner', value: 'k8s.io/minikube-hostpath' },
    { op: 'remove', path: '/parameters' },
    { op: 'replace', path: '/volumeBindingMode', value: 'Immediate' },
  ]),
  json6902('kind: ClusterIssuer\nname: letsencrypt', [
    { op: 'replace', path: '/spec', value: { selfSigned: {} } },
  ]),
  json6902('kind: Gateway\nname: r10c-edge', [
    { op: 'remove', path: '/spec/addresses' },
  ]),
  json6902('kind: Deployment\nnamespace: r10c', [
    {
      op: 'replace',
      path: '/spec/template/spec/containers/0/resources/requests',
      value: { cpu: '10m', memory: '64Mi' },
    },
  ]),
  strategic(
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: zitadel',
      '  namespace: r10c',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: zitadel',
      '          env:',
      ...(
        [
          ['ZITADEL_DATABASE_POSTGRES_DATABASE', LAB_ZITADEL_DATABASE],
          ['ZITADEL_DATABASE_POSTGRES_USER_USERNAME', LAB_ZITADEL_DATABASE],
          ['ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE', 'disable'],
          ['ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE', 'disable'],
        ] as const
      ).flatMap(([name, value]) => [
        `            - name: ${name}`,
        `              value: ${value}`,
      ]),
    ].join('\n'),
  ),
  // auth-service calls Zitadel at its public issuer, through the edge, whose
  // certificate in the lab is self-signed: trust exactly that one.
  strategic(
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: auth-service',
      '  namespace: r10c',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: auth-service',
      '          env:',
      '            - name: NODE_EXTRA_CA_CERTS',
      '              value: /edge-ca/ca.crt',
      '          volumeMounts:',
      '            - name: edge-ca',
      '              mountPath: /edge-ca',
      '              readOnly: true',
      '      volumes:',
      '        - name: edge-ca',
      '          secret:',
      '            secretName: edge-tls',
      '            optional: true',
    ].join('\n'),
  ),
  strategic(
    [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: zitadel-config',
      '  namespace: r10c',
      'data:',
      '  zitadel.yaml: |',
      '    HTTPClient:',
      '      DenyList:',
      ...zitadelDenyList(MINIKUBE_SERVICE_RANGE).map(
        entry => `        - '${entry}'`,
      ),
    ].join('\n'),
  ),
];

/**
 * The overlay's `kustomization.yaml`. `base` is the committed tree, relative
 * to the overlay's own directory.
 */
export const overlayKustomization = (
  target: Target,
  base: string,
  images: readonly Image[],
): string =>
  [
    '# Generated by tools/infra for one up — do not edit, not committed.',
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'resources:',
    `  - ${base}`,
    ...(images.length > 0
      ? [
          'images:',
          ...images.flatMap(image => [
            `  - name: ${image.name}`,
            `    newName: ${image.newName}`,
            `    newTag: '${image.newTag}'`,
          ]),
        ]
      : []),
    ...(target === 'lab' ? ['patches:', ...labPatches()] : []),
    '',
  ].join('\n');
