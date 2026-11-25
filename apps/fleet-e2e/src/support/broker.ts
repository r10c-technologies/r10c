import { execFileSync } from 'node:child_process';

import { PROFILE } from './profile';

/**
 * Stopping and starting the fleet's broker, wherever it runs (#704).
 *
 * On the dev fleet the broker is the lab's own Deployment; in a cluster it is
 * the operator's StatefulSet, and the operator is stopped first or it puts the
 * broker straight back. Either way the broker's disk is kept, so what was
 * queued before the stop is still there after it.
 */
const kubectl = (...args: string[]) =>
  execFileSync('kubectl', args, { encoding: 'utf8', stdio: 'pipe' });

const scale = (replicas: number) => {
  if (PROFILE.name === 'local') {
    kubectl(
      '-n',
      'marketplace-local-infra',
      'scale',
      'deployment',
      'rabbitmq',
      `--replicas=${String(replicas)}`,
    );
    return;
  }
  const operator = [
    '-n',
    'rabbitmq-system',
    'scale',
    'deployment',
    '--all',
    `--replicas=${String(replicas)}`,
  ];
  const broker = [
    '-n',
    'r10c',
    'scale',
    'statefulset',
    'rabbitmq-server',
    `--replicas=${String(replicas)}`,
  ];
  // Down: the operator first, or it reconciles the broker back. Up: the
  // broker first, then the operator that would have restored it anyway.
  for (const args of replicas === 0 ? [operator, broker] : [broker, operator])
    kubectl(...args);
};

const selector = () =>
  PROFILE.name === 'local'
    ? ['-n', 'marketplace-local-infra', 'pod', '-l', 'app=rabbitmq']
    : ['-n', 'r10c', 'pod', 'rabbitmq-server-0'];

export const stopBroker = () => {
  scale(0);
  kubectl('wait', '--for=delete', ...selector(), '--timeout=120s');
};

export const startBroker = () => {
  scale(1);
  // The pod is created a moment after the scale; `wait` refuses a name that
  // does not exist yet.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      kubectl('wait', '--for=condition=Ready', ...selector(), '--timeout=300s');
      return;
    } catch {
      execFileSync('sleep', ['2']);
    }
  }
  throw new Error('the broker did not come back');
};
