/**
 * Rendering a project nobody is editing.
 *
 * `NodeView` reads the open project out of the editor's store, which is right
 * for the canvas — it is how one heading can re-render without waking the tree
 * — and useless for a preview, because a preview is of a project that is not
 * open and must not become open. Loading a candidate into the store to look at
 * it would replace whatever the editor is holding.
 *
 * So this takes the project as an argument and renders it with no store, no
 * subscriptions, no memoisation and no interaction. It shares `resolve.ts` with
 * the canvas and the export generator, so all three still agree on what a node
 * means; what it does not share is where the project comes from.
 *
 * Instances are flattened by the caller. A preview has no selection and no
 * inspector, so there is nothing that resolution rules would buy it.
 */

import { createElement, Fragment, type ReactNode } from 'react';
import type { Breakpoint, Project } from '@zory/core';
import { themeStyleObject } from '@zory/core';
import { resolveSrc, tagFor, toCssProperties } from './resolve';

interface StaticNodeProps {
  project: Project;
  nodeId: string;
  breakpoint: Breakpoint;
}

function StaticNode({ project, nodeId, breakpoint }: StaticNodeProps): ReactNode {
  const node = project.nodes[nodeId];
  if (!node) return null;

  const style = toCssProperties(node.styles, breakpoint);

  if (node.kind === 'image') {
    return createElement('img', {
      src: resolveSrc(node.props.src, project.assets),
      alt: node.props.alt ?? '',
      style,
      draggable: false,
    });
  }

  if (node.kind === 'divider') return createElement('div', { style });

  const children = node.children.length
    ? node.children.map((childId) => (
        <StaticNode key={childId} project={project} nodeId={childId} breakpoint={breakpoint} />
      ))
    : (node.text ?? null);

  /*
   * `href` is dropped and buttons are disabled on purpose. This is a picture of
   * a page, and a preview whose links navigate away from the dialog they are
   * inside is a preview that loses somebody's choices.
   */
  const props: Record<string, unknown> = { style };
  if (node.kind === 'button') props.disabled = true;
  if (node.kind === 'link') props.role = 'presentation';

  return createElement(tagFor(node) === 'a' ? 'span' : tagFor(node), props, children);
}

export interface StaticPageProps {
  project: Project;
  /** Which page to draw. Defaults to the first. */
  pageId?: string;
  breakpoint?: Breakpoint;
}

/** A whole page of a project, themed, with nothing interactive in it. */
export function StaticPage({ project, pageId, breakpoint = 'base' }: StaticPageProps): ReactNode {
  const page = pageId ? project.pages.find((p) => p.id === pageId) : project.pages[0];
  if (!page) return null;

  return (
    <div style={themeStyleObject(project.settings.theme)}>
      <Fragment>
        <StaticNode project={project} nodeId={page.rootId} breakpoint={breakpoint} />
      </Fragment>
    </div>
  );
}
