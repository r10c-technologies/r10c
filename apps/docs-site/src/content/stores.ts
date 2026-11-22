import { SLICES } from '@r10c/slices';

/** The store that hosts a domain's entities, and the one slice that writes it. */
export const storeOf = (domain: string) => {
  for (const slice of SLICES) {
    const store = slice.stores.find(candidate =>
      candidate.hosts.includes(domain),
    );
    if (store !== undefined) return { store, slice };
  }
  return undefined;
};
