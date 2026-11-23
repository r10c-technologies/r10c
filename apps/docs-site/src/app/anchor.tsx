import defaultMdxComponents from 'fumadocs-ui/mdx';
import { type ComponentProps, isValidElement } from 'react';

import { OPENAPI_PATH } from '../content/api';
import { FLOW_SCHEME } from '../content/flows';
import { MAP_SCHEME } from '../content/use-cases';
import { EntityMap } from './entity-map';
import { FlowMap } from './flow-map';

/** What the site serves beside it rather than renders: the Storybook and the OpenAPI documents. */
const BESIDE = ['/ui/', OPENAPI_PATH];

/**
 * A page's links: fumadocs' own, which navigate inside the site on the client,
 * except into `/ui/` or `/openapi/`, which are files rather than pages — a
 * client navigation there asks for a route tree that does not exist.
 */
export function Anchor(props: ComponentProps<'a'>) {
  if (BESIDE.some(prefix => props.href?.startsWith(prefix))) {
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
  if (typeof props.src === 'string' && props.src.startsWith(FLOW_SCHEME)) {
    return <FlowMap src={props.src} />;
  }
  const Image = defaultMdxComponents.img as (
    imageProps: ComponentProps<'img'>,
  ) => React.ReactNode;
  return <Image {...props} alt={props.alt ?? ''} />;
}

/** Whether a paragraph holds nothing but a flow's diagram. */
const holdsFlow = (children: ComponentProps<'p'>['children']) =>
  isValidElement<{ src?: unknown }>(children) &&
  typeof children.props.src === 'string' &&
  children.props.src.startsWith(FLOW_SCHEME);

/**
 * A page's paragraphs, except the one markdown wraps around a flow's diagram:
 * that diagram is a block — a canvas and its button — and a block inside a
 * `<p>` is invalid HTML a browser repairs differently from React.
 */
export function Paragraph(props: ComponentProps<'p'>) {
  if (holdsFlow(props.children)) {
    return <div className="my-6">{props.children}</div>;
  }
  return <p {...props} />;
}

export const PAGE_COMPONENTS = { a: Anchor, img: Figure, p: Paragraph };
