import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { ComponentProps } from 'react';

import { MAP_SCHEME } from '../content/use-cases';
import { EntityMap } from './entity-map';

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

/** A page's images: fumadocs' own, except the maps the site draws itself. */
export function Figure(props: ComponentProps<'img'>) {
  if (typeof props.src === 'string' && props.src.startsWith(MAP_SCHEME)) {
    return <EntityMap src={props.src} />;
  }
  const Image = defaultMdxComponents.img as (
    imageProps: ComponentProps<'img'>,
  ) => React.ReactNode;
  return <Image {...props} alt={props.alt ?? ''} />;
}

export const PAGE_COMPONENTS = { a: Anchor, img: Figure };
