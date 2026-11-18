/**
 * A project as plain HTML pages: one self-contained file per page.
 *
 * This is what a demo site is when it leaves the editor — the page a business
 * owner opens from a cold email. No React, no JavaScript, no build step: every
 * rule from the editor's cascade becomes one class, tablet and mobile overrides
 * become the same two `max-width` queries the React export writes, and images
 * are inlined (data URIs) or left pointing where the author pointed them.
 *
 * Internal links ("/about") are rewritten relative to the page, so the same
 * files work at /s/<slug>/ on your machine and at the root of any static host.
 */

import type { Breakpoint, ElementNode, Project, StyleProps } from '@zory/core';
import { BREAKPOINTS, flattenInstances, isEmptyMotion } from '@zory/core';
import { buildStylesheet, globalCss } from './css';
import { REVEAL_ATTRIBUTE, VISIBLE_ATTRIBUTE, motionCssFor, nodeNeedsReveal } from './motion';
import { resolveSrc } from '../../renderer/resolve';

const VOID = new Set(['img', 'hr', 'br', 'input']);

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "/" → "", "/about/" → "about" */
function clean(route: string): string {
  return route.replace(/^\/+|\/+$/g, '');
}

/** The href from the page at `from` to the page at `to`, both site routes. */
export function relativeHref(from: string, to: string): string {
  const [path, hash = ''] = to.split('#');
  const depth = clean(from) === '' ? 0 : clean(from).split('/').length;
  const up = '../'.repeat(depth);
  const target = clean(path ?? '');
  const out = target === '' ? up || './' : `${up}${target}/`;
  return hash ? `${out}#${hash}` : out;
}

function stylesFor(node: ElementNode): Partial<Record<Breakpoint, StyleProps>> {
  const out: Partial<Record<Breakpoint, StyleProps>> = {};
  for (const bp of BREAKPOINTS) {
    const s = node.styles[bp];
    if (s && Object.keys(s).length > 0) out[bp] = s;
  }
  return out;
}

interface Scope {
  project: Project;
  classes: Map<string, string>;
  route: string;
}

function renderNode(scope: Scope, id: string): string {
  const node = scope.project.nodes[id];
  if (!node) return '';
  const attrs: string[] = [];
  const cls = scope.classes.get(id);
  if (cls) attrs.push(`class="${cls}"`);
  // No script on a static page: reveal elements start visible and animate on load.
  if (nodeNeedsReveal(node)) attrs.push(REVEAL_ATTRIBUTE, VISIBLE_ATTRIBUTE);
  if (node.props.anchor) attrs.push(`id="${esc(node.props.anchor)}"`);

  let tag: string;
  switch (node.kind) {
    case 'container':
      tag = node.props.tag ?? 'div';
      break;
    case 'heading':
      tag = `h${node.props.level ?? 2}`;
      break;
    case 'text':
      tag = 'p';
      break;
    case 'button':
      tag = 'button';
      attrs.push('type="button"');
      break;
    case 'link': {
      tag = 'a';
      const raw = node.props.href ?? '#';
      const href = raw.startsWith('/') && !raw.startsWith('//') ? relativeHref(scope.route, raw) : raw;
      attrs.push(`href="${esc(href)}"`);
      if (node.props.target === '_blank') attrs.push('target="_blank" rel="noopener noreferrer"');
      break;
    }
    case 'image': {
      tag = 'img';
      const src = resolveSrc(node.props.src, scope.project.assets);
      if (src) attrs.push(`src="${esc(src)}"`);
      attrs.push(`alt="${esc(node.props.alt ?? '')}"`, 'loading="lazy"');
      break;
    }
    case 'divider':
      tag = 'hr';
      break;
    default:
      tag = 'div';
  }

  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  if (VOID.has(tag)) return open;
  const text = node.text?.trim() ? esc(node.text).replace(/\n/g, '<br>') : '';
  const children = node.children.map((child) => renderNode(scope, child)).join('');
  return `${open}${text}${children}</${tag}>`;
}

function collect(project: Project, rootId: string, classes: Map<string, string>, ids: string[]): void {
  const walk = (id: string): void => {
    const node = project.nodes[id];
    if (!node) return;
    const has = BREAKPOINTS.some((bp) => Object.keys(node.styles[bp] ?? {}).length > 0);
    if (has || !isEmptyMotion(node.motion)) {
      classes.set(id, `z${classes.size.toString(36)}`);
      ids.push(id);
    }
    node.children.forEach(walk);
  };
  walk(rootId);
}

/** `{route: html}` for every page of the project. */
export function generateStaticSite(source: Project): Record<string, string> {
  const project = flattenInstances(source);
  const out: Record<string, string> = {};
  for (const page of project.pages) {
    const classes = new Map<string, string>();
    const ids: string[] = [];
    collect(project, page.rootId, classes, ids);
    const rules = ids.map((id) => ({
      className: classes.get(id)!,
      byBreakpoint: stylesFor(project.nodes[id]!),
    }));
    const css =
      globalCss(project.settings.theme) +
      '\n' +
      buildStylesheet(rules, project.settings.breakpoints, `${project.name}: ${page.name}`) +
      motionCssFor(project, ids, classes).css;
    const route = '/' + clean(page.path ?? '/');
    const body = renderNode({ project, classes, route }, page.rootId);
    const title = page.name && route !== '/' ? `${page.name} | ${project.name}` : project.name;
    out[route] = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="generator" content="OpenLeads Studio">
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
  }
  return out;
}
