import { notFound } from 'next/navigation';

/**
 * Where the proxy sends a `/p/` or `/c/` address that names nothing.
 *
 * Nothing here reads the request, so `notFound()` runs while the page is
 * prerendered and the route is served as a static `404`: the status the
 * proxy asked for, with the not-found page as its body.
 */
export default function Missing() {
  notFound();
}
