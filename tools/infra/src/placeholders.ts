/**
 * What `tools/edge` writes into the manifests where the cloud's own values go
 * (`DOMAIN_PLACEHOLDER`, `ADDRESS_PLACEHOLDER` there). A tool may not import
 * another tool's source, so they are restated here, and the spec fails the
 * day the two differ.
 */
export const DOMAIN_PLACEHOLDER = 'r10c.invalid';
export const ADDRESS_PLACEHOLDER = '192.0.2.1';
