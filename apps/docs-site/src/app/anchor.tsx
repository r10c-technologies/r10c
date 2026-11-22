import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { ComponentProps } from 'react';

/** What the site serves beside it rather than renders: the Storybook. */
const BESIDE = '/ui/';

/**
 * A page's links: fumadocs' own, which navigate inside the site on the client,
 * except into `/ui/`, which is another application's files — a client
 * navigation there asks for a route tree that does not exist.
 */
export function Anchor(props: ComponentProps<'a'>) {
  if (props.href?.startsWith(BESIDE)) {
    const { children, ...rest } = props;
    return <a {...rest}>{children}</a>;
  }
  const Link = defaultMdxComponents.a as (
    linkProps: ComponentProps<'a'>,
  ) => React.ReactNode;
  return <Link {...props} />;
}

export const PAGE_COMPONENTS = { a: Anchor };
