import { Alert } from '@entifix/react-controls/primitives';

/**
 * What a sample store's product and seller pages say before anything else
 * (#676): this is one of the lab's demonstration stores, and its prices are
 * illustrative rather than a quote anybody gave. An `Alert` rather than a
 * hand-written `role="status"`, as every storefront notice is (ADR 0075).
 *
 * Plain labels in, so it renders the same in a server page and a spec.
 */
export function SampleStoreNote({ label }: { readonly label: string }) {
  return (
    <Alert tone="info" data-testid="sample-store-note">
      {label}
    </Alert>
  );
}
