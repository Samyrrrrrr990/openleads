/**
 * Command validation.
 *
 * This is the trust boundary. Commands may originate from Intent Mode — which
 * is designed to accept pluggable providers, including remote models — so
 * nothing is applied until it has been checked here. Validation covers both
 * structural correctness (does this node exist? would this move create a
 * cycle?) and value safety (no `javascript:` URLs, no CSS escape sequences).
 */

import type { Project, StyleKey, StyleProps } from '../graph/types';
import { BREAKPOINTS } from '../graph/types';
import type { EasingName, EntranceEffect, NodeMotion } from '../motion/types';
import { EASING_CSS, ENTRANCE_EFFECTS, MOTION_LIMITS } from '../motion/types';
import { findNode, isAncestorOf, isPageRoot } from '../graph/selectors';
import type { ValidationResult, ZoryCommand } from './types';

const ok: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/**
 * Every style property Zory can set. A command naming anything outside this
 * list is rejected rather than silently ignored, so a malformed provider
 * response surfaces as an error instead of a partial edit.
 */
const ALLOWED_STYLE_KEYS: ReadonlySet<string> = new Set<StyleKey>([
  'display',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'flexWrap',
  'gap',
  'gridTemplateColumns',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'maxWidth',
  'minHeight',
  'height',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'color',
  'backgroundColor',
  'backgroundImage',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'transform',
  'transformOrigin',
  'perspective',
  'transition',
  'filter',
  'backdropFilter',
  'position',
  'left',
  'top',
  'zIndex',
  'opacity',
  'objectFit',
]);

const ALLOWED_PROP_KEYS: ReadonlySet<string> = new Set([
  'level',
  'tag',
  'href',
  'target',
  'src',
  'alt',
  'anchor',
]);

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'div',
  'header',
  'nav',
  'main',
  'section',
  'article',
  'aside',
  'footer',
  'ul',
  'li',
]);

/**
 * Characters that would let a value break out of a CSS declaration when the
 * export generator writes it into a stylesheet.
 */
const CSS_BREAKOUT = /[;{}<>\\]/;
const CSS_DANGEROUS_FN = /(?:javascript|vbscript|data)\s*:|expression\s*\(|@import|behaviou?r\s*:/i;

const MAX_STYLE_VALUE_LENGTH = 400;
const MAX_TEXT_LENGTH = 20_000;
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 4_000;
/** Data URIs are base64, so this bounds the decoded image at roughly 3 MB. */
const MAX_ASSET_BYTES = 4_200_000;

export function isSafeCssValue(value: string): boolean {
  if (value.length > MAX_STYLE_VALUE_LENGTH) return false;
  if (CSS_BREAKOUT.test(value)) return false;
  if (CSS_DANGEROUS_FN.test(value)) return false;
  return true;
}

/**
 * URLs are restricted to a scheme allowlist. Relative paths, anchors and
 * mailto/tel links are permitted; anything script-bearing is not.
 */
/**
 * Zory's own reference scheme for an image stored inside the project.
 *
 * `asset:<id>` is never handed to the browser as a URL. `resolveSrc` looks the
 * id up in the project's asset table and substitutes the data URI it finds, or
 * an empty string if there is none — so the value cannot navigate anywhere,
 * cannot reach the network, and cannot name anything outside the project it
 * lives in.
 *
 * It has to be named here because it was not, and the consequence was that the
 * only way to put an image into a Zory project did not work. The Assets panel
 * writes `SET_PROP { src: 'asset:a_xxxxxxxx' }`, `isSafeUrl` fell through to
 * the scheme check, `asset:` is not http/https/mailto/tel, and the command was
 * rejected as an unsafe image source. The panel ignored the failed result, so
 * pressing "Use" did nothing at all and said nothing about why.
 */
const ASSET_REF = /^asset:[a-z0-9_]{1,64}$/;

export function isSafeUrl(value: string, opts: { allowData?: boolean } = {}): boolean {
  // Data URIs carry the image itself, so they get the asset budget instead of
  // the (much smaller) link budget.
  const limit = opts.allowData ? MAX_ASSET_BYTES : MAX_URL_LENGTH;
  if (value.length > limit) return false;
  const trimmed = value.trim();
  if (trimmed === '') return true;

  /*
   * Only in an image-source context, and only in exactly this shape.
   *
   * `allowData` marks the places that render a value as an image rather than
   * navigate to it, which is the same set of places an asset reference is
   * meaningful. A strict pattern rather than a `startsWith`, because a lax one
   * would let `asset:../../x` or `asset:javascript:…` through to anything that
   * later decided to treat the tail as a path.
   */
  if (opts.allowData && ASSET_REF.test(trimmed)) return true;
  // Strip control characters and spaces before the scheme check — browsers
  // resolve `java\0script:` and `java\tscript:` as script URLs.
  // eslint-disable-next-line no-control-regex
  const normalised = trimmed.replace(/[\u0000-\u0020\u007F]/g, '').toLowerCase();
  if (/^(?:javascript|vbscript|file|blob):/.test(normalised)) return false;
  if (normalised.startsWith('data:')) {
    return (
      Boolean(opts.allowData) &&
      /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,/.test(normalised)
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(normalised)) {
    return /^(?:https?|mailto|tel):/.test(normalised);
  }
  // Relative path, protocol-relative URL, query or fragment.
  return true;
}

/*
 * Properties whose value is a fixed vocabulary rather than free-form CSS.
 *
 * `position` is the one that matters. The TypeScript union is compile-time
 * only, so a command arriving from a model, an import or a older project file
 * could carry `fixed` or `sticky` — and a fixed element escapes its container
 * to sit over the whole viewport, which breaks the canvas and would let
 * generated content cover the editor's own chrome.
 */
const ENUM_VALUES: Record<string, ReadonlySet<string>> = {
  position: new Set(['static', 'relative', 'absolute']),
};

function validateStyleValue(key: string, value: unknown): ValidationResult {
  if (value === null) return ok;

  const allowed = ENUM_VALUES[key];
  if (allowed && !(typeof value === 'string' && allowed.has(value))) {
    return fail(`"${key}" must be one of: ${[...allowed].join(', ')}`);
  }

  if (key === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      return fail('opacity must be a number between 0 and 1');
    }
    return ok;
  }

  if (typeof value !== 'string') return fail(`"${key}" must be a string`);
  if (!isSafeCssValue(value)) return fail(`unsafe value for "${key}"`);

  /*
   * `filter` and `backdropFilter` accept `url(#id)`, which points at an SVG
   * filter element and is a way to pull arbitrary referenced content into the
   * render. Nothing in Zory needs it, and the blur/saturate/brightness
   * functions people actually want do not use it, so the whole form is
   * refused rather than parsed.
   */
  if ((key === 'filter' || key === 'backdropFilter') && /url\s*\(/i.test(value)) {
    return fail(`"${key}" may not reference a url`);
  }

  if (key === 'backgroundImage' && value !== 'none') {
    const urls = [...value.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)];
    for (const match of urls) {
      if (!isSafeUrl(match[1] ?? '', { allowData: true })) return fail('unsafe background image url');
    }
  }

  return ok;
}

export function validateStylePatch(patch: unknown): ValidationResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return fail('style patch must be an object');
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return fail('style patch is empty');
  for (const [key, value] of entries) {
    if (!ALLOWED_STYLE_KEYS.has(key)) return fail(`unsupported style property "${key}"`);
    const result = validateStyleValue(key, value);
    if (!result.ok) return result;
  }
  return ok;
}

function validatePropPatch(patch: unknown): ValidationResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return fail('prop patch must be an object');
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return fail('prop patch is empty');

  for (const [key, value] of entries) {
    if (!ALLOWED_PROP_KEYS.has(key)) return fail(`unsupported property "${key}"`);
    if (value === null) continue;

    switch (key) {
      case 'level':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) {
          return fail('heading level must be an integer from 1 to 6');
        }
        break;
      case 'tag':
        if (typeof value !== 'string' || !ALLOWED_TAGS.has(value)) {
          return fail(`unsupported tag "${String(value)}"`);
        }
        break;
      case 'target':
        if (value !== '_self' && value !== '_blank') return fail('target must be _self or _blank');
        break;
      case 'href':
        if (typeof value !== 'string' || !isSafeUrl(value)) return fail('unsafe link url');
        break;
      case 'src':
        if (typeof value !== 'string' || !isSafeUrl(value, { allowData: true })) {
          return fail('unsafe image source');
        }
        break;
      case 'alt':
        if (typeof value !== 'string' || value.length > MAX_NAME_LENGTH * 4) {
          return fail('alt text is too long');
        }
        break;
      /*
       * An anchor becomes an `id` attribute, so it has to be a legal one and
       * it has to be one that cannot be read as anything else. Letters,
       * digits, hyphens and underscores, starting with a letter: no spaces
       * (which silently break `#href` matching), no colons or dots (which are
       * legal in HTML5 and a trap in every CSS selector), and nothing that
       * could be mistaken for a URL fragment somebody did not write.
       */
      case 'anchor':
        if (typeof value !== 'string') return fail('anchor must be a string');
        if (value.length > 64) return fail('anchor is too long');
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
          return fail('anchor must start with a letter and use only letters, digits, - and _');
        }
        break;
      default:
        return fail(`unsupported property "${key}"`);
    }
  }
  return ok;
}

/**
 * Checks a command against a project. Returns a human-readable reason on
 * failure so Intent Mode can explain what it refused to do.
 */
export function validateCommand(project: Project, command: ZoryCommand): ValidationResult {
  if (typeof command !== 'object' || command === null) return fail('command must be an object');

  switch (command.type) {
    case 'SET_TEXT': {
      const node = findNode(project, command.nodeId);
      if (!node) return fail(`node "${command.nodeId}" does not exist`);
      if (typeof command.text !== 'string') return fail('text must be a string');
      if (command.text.length > MAX_TEXT_LENGTH) return fail('text is too long');
      if (node.kind === 'image' || node.kind === 'divider') {
        return fail(`${node.kind} nodes do not hold text`);
      }
      return ok;
    }

    case 'SET_STYLE': {
      if (!findNode(project, command.nodeId)) return fail(`node "${command.nodeId}" does not exist`);
      if (!BREAKPOINTS.includes(command.breakpoint)) {
        return fail(`unknown breakpoint "${command.breakpoint}"`);
      }
      return validateStylePatch(command.patch);
    }

    case 'SET_PROP': {
      const node = findNode(project, command.nodeId);
      if (!node) return fail(`node "${command.nodeId}" does not exist`);
      const result = validatePropPatch(command.patch);
      if (!result.ok) return result;
      if ('level' in command.patch && node.kind !== 'heading') {
        return fail('only headings have a level');
      }
      return ok;
    }

    case 'SET_MOTION': {
      if (!findNode(project, command.nodeId)) return fail(`node "${command.nodeId}" does not exist`);
      if (command.motion === null) return ok;
      return validateMotion(command.motion);
    }

    case 'SET_THEME': {
      if (typeof command.patch !== 'object' || command.patch === null) {
        return fail('theme patch must be an object');
      }
      for (const [key, value] of Object.entries(command.patch)) {
        if (value === undefined) continue;
        if (!THEME_KEYS.has(key)) return fail(`unknown theme token "${key}"`);
        if (typeof value !== 'string') return fail(`theme token "${key}" must be a string`);
        if (value.length > 200) return fail(`theme token "${key}" is too long`);
        if (!isSafeCssValue(value)) return fail(`theme token "${key}" contains an unsafe value`);
      }
      return ok;
    }

    case 'RENAME_NODE': {
      if (!findNode(project, command.nodeId)) return fail(`node "${command.nodeId}" does not exist`);
      if (typeof command.name !== 'string') return fail('name must be a string');
      if (command.name.trim() === '') return fail('name cannot be empty');
      if (command.name.length > MAX_NAME_LENGTH) return fail('name is too long');
      return ok;
    }

    case 'SET_PROJECT_NAME': {
      if (typeof command.name !== 'string') return fail('name must be a string');
      if (command.name.trim() === '') return fail('project name cannot be empty');
      if (command.name.length > MAX_NAME_LENGTH) return fail('project name is too long');
      return ok;
    }

    case 'INSERT_NODE': {
      const parent = findNode(project, command.parentId);
      if (!parent) return fail(`parent "${command.parentId}" does not exist`);
      if (parent.kind !== 'container') return fail(`${parent.kind} nodes cannot hold children`);
      if (!Array.isArray(command.nodes) || command.nodes.length === 0) return fail('nothing to insert');
      if (!command.nodes.some((n) => n.id === command.rootId)) {
        return fail('subtree does not contain its root');
      }
      /*
       * The payload has to be a well-formed subtree, not just a bag of nodes.
       *
       * Everything above this point checks the nodes one at a time, which says
       * nothing about the shape they describe together. A payload with two
       * nodes sharing an id, a child reference pointing at nothing, a node
       * nobody links to, or a cycle would splice straight into the graph and
       * corrupt it — and Intent Mode is allowed to hand this command to remote
       * providers, so "nobody would send that" is not a guarantee available
       * here.
       */
      const byId = new Map<string, (typeof command.nodes)[number]>();
      for (const node of command.nodes) {
        if (typeof node.id !== 'string' || node.id === '') return fail('node is missing an id');
        if (byId.has(node.id)) return fail(`subtree repeats node "${node.id}"`);
        byId.set(node.id, node);
        if (findNode(project, node.id)) return fail(`node "${node.id}" already exists`);
        for (const bp of BREAKPOINTS) {
          const styles = node.styles[bp];
          if (!styles) continue;
          const result = validateStylePatch(styles as StyleProps);
          if (!result.ok) return result;
        }
        const propsResult = Object.keys(node.props).length > 0 ? validatePropPatch(node.props) : ok;
        if (!propsResult.ok) return propsResult;
        /*
         * Motion has to be checked here for the same reason styles are.
         * `repairProject` deletes motion that fails `validateMotion`, silently
         * and on load rather than on write, so motion admitted here without a
         * check does not fail — it disappears later, in a different session,
         * with nothing to point at. Saved sections and animated starters both
         * arrive through this command carrying motion.
         */
        if (node.motion !== undefined) {
          const motionResult = validateMotion(node.motion);
          if (!motionResult.ok) return motionResult;
        }
      }

      // Every child reference resolves inside the payload, and no node is
      // claimed by two parents.
      const claimed = new Set<string>();
      for (const node of command.nodes) {
        const children = node.kind === 'container' ? node.children : [];
        if (!Array.isArray(children)) return fail(`node "${node.id}" has a malformed child list`);
        for (const childId of children) {
          if (!byId.has(childId)) {
            return fail(`node "${node.id}" references missing child "${childId}"`);
          }
          if (childId === node.id) return fail(`node "${node.id}" contains itself`);
          if (claimed.has(childId)) return fail(`node "${childId}" has two parents`);
          claimed.add(childId);
        }
      }

      // Walking from the root reaches everything exactly once. That rules out
      // both orphans in the payload and any cycle, which would otherwise make
      // this walk run forever.
      const seen = new Set<string>();
      const queue = [command.rootId];
      while (queue.length > 0) {
        const id = queue.pop() as string;
        if (seen.has(id)) return fail('subtree contains a cycle');
        seen.add(id);
        const node = byId.get(id);
        if (!node) return fail(`subtree references missing node "${id}"`);
        if (node.kind === 'container') queue.push(...node.children);
      }
      if (seen.size !== command.nodes.length) {
        return fail('subtree contains nodes unreachable from its root');
      }

      if (command.index < 0 || command.index > parent.children.length) {
        return fail('insert index is out of range');
      }
      return ok;
    }

    case 'DELETE_NODE': {
      const node = findNode(project, command.nodeId);
      if (!node) return fail(`node "${command.nodeId}" does not exist`);
      if (isPageRoot(project, command.nodeId)) return fail('a page root cannot be deleted');
      if (!node.parentId) return fail('node has no parent');
      return ok;
    }

    case 'MOVE_NODE': {
      const node = findNode(project, command.nodeId);
      if (!node) return fail(`node "${command.nodeId}" does not exist`);
      if (isPageRoot(project, command.nodeId)) return fail('a page root cannot be moved');
      const parent = findNode(project, command.parentId);
      if (!parent) return fail(`parent "${command.parentId}" does not exist`);
      if (parent.kind !== 'container') return fail(`${parent.kind} nodes cannot hold children`);
      if (isAncestorOf(project, command.nodeId, command.parentId)) {
        return fail('a node cannot be moved inside itself');
      }
      const siblingCount = parent.children.length + (node.parentId === command.parentId ? -1 : 0);
      if (command.index < 0 || command.index > siblingCount) return fail('move index is out of range');
      return ok;
    }

    case 'DUPLICATE_NODE': {
      const node = findNode(project, command.nodeId);
      if (!node) return fail(`node "${command.nodeId}" does not exist`);
      if (isPageRoot(project, command.nodeId)) return fail('a page root cannot be duplicated');
      if (!node.parentId) return fail('node has no parent');
      if (typeof command.idMap !== 'object' || command.idMap === null) return fail('missing id map');

      /*
       * The map has to cover the subtree exactly.
       *
       * A missing entry means the copy keeps an original id and the graph ends
       * up with two nodes answering to it; two entries pointing at the same new
       * id does the same thing from the other direction. An entry for a node
       * outside the subtree means the caller is describing a different graph
       * than the one being duplicated, which is worth refusing rather than
       * quietly ignoring.
       */
      const subtree = new Set<string>();
      const pending = [command.nodeId];
      while (pending.length > 0) {
        const id = pending.pop() as string;
        if (subtree.has(id)) continue;
        subtree.add(id);
        const current = findNode(project, id);
        if (current?.kind === 'container') pending.push(...current.children);
      }

      const assigned = new Set<string>();
      for (const sourceId of subtree) {
        const newId = command.idMap[sourceId];
        if (typeof newId !== 'string' || newId === '') {
          return fail(`id map is missing an entry for "${sourceId}"`);
        }
        if (findNode(project, newId)) return fail(`node "${newId}" already exists`);
        if (assigned.has(newId)) return fail(`id map assigns "${newId}" twice`);
        assigned.add(newId);
      }
      for (const sourceId of Object.keys(command.idMap)) {
        if (!subtree.has(sourceId)) {
          return fail(`id map has an entry for "${sourceId}", which is not in the subtree`);
        }
      }
      return ok;
    }

    case 'ADD_ASSET': {
      const { asset } = command;
      if (!asset || typeof asset !== 'object') return fail('asset is missing');
      if (typeof asset.id !== 'string' || asset.id === '') return fail('asset needs an id');
      if (project.assets.some((a) => a.id === asset.id)) return fail('that asset already exists');
      if (asset.kind !== 'image') return fail('only images are supported');
      if (typeof asset.src !== 'string' || !isSafeUrl(asset.src, { allowData: true })) {
        return fail('unsafe asset source');
      }
      if (asset.src.length > MAX_ASSET_BYTES) return fail('that image is too large (limit 3 MB)');
      if (typeof asset.name !== 'string' || asset.name.length > MAX_NAME_LENGTH) {
        return fail('asset name is too long');
      }
      return ok;
    }

    case 'REMOVE_ASSET': {
      if (!project.assets.some((a) => a.id === command.assetId)) {
        return fail('that asset does not exist');
      }
      return ok;
    }

    case 'CREATE_COMPONENT': {
      const def = command.def;
      if (!def || typeof def !== 'object') return fail('component definition is malformed');
      if (typeof def.id !== 'string' || def.id === '') return fail('component is missing an id');
      if (project.components?.[def.id]) return fail(`component "${def.id}" already exists`);
      if (typeof def.name !== 'string' || def.name.length > MAX_NAME_LENGTH) {
        return fail('component name is too long');
      }
      if (!def.nodes || typeof def.nodes !== 'object') return fail('component has no nodes');
      if (!def.nodes[def.rootId]) return fail('component does not contain its own root');
      for (const [id, node] of Object.entries(def.nodes)) {
        if (node.id !== id) return fail(`component node "${id}" disagrees about its own id`);
        /*
         * An instance inside a definition would let a definition contain
         * itself, directly or through a chain, and the renderer resolves
         * definitions on the way out with no depth limit.
         */
        if (node.kind === 'instance') return fail('a component cannot contain an instance yet');
        const styleResult = validateNodeStyles(node);
        if (!styleResult.ok) return styleResult;
        if (Object.keys(node.props).length > 0) {
          const propsResult = validatePropPatch(node.props);
          if (!propsResult.ok) return propsResult;
        }
        if (node.motion !== undefined) {
          const motionResult = validateMotion(node.motion);
          if (!motionResult.ok) return motionResult;
        }
        for (const childId of node.children) {
          if (!def.nodes[childId]) return fail(`component node "${id}" references missing child`);
        }
      }
      return ok;
    }

    case 'DELETE_COMPONENT': {
      if (!project.components?.[command.componentId]) return fail('that component does not exist');
      const used = Object.values(project.nodes).some(
        (node) => node.kind === 'instance' && node.componentId === command.componentId,
      );
      // Deleting it would leave those instances pointing at nothing.
      if (used) return fail('that component is still in use');
      return ok;
    }

    case 'SET_OVERRIDE': {
      const instance = project.nodes[command.nodeId];
      if (!instance) return fail(`node "${command.nodeId}" does not exist`);
      if (instance.kind !== 'instance' || !instance.componentId) {
        return fail('only an instance carries overrides');
      }
      const def = project.components?.[instance.componentId];
      if (!def) return fail('that instance points at a missing component');
      if (!def.nodes[command.defNodeId]) {
        return fail(`component has no node "${command.defNodeId}"`);
      }
      const override = command.override;
      if (override === null) return ok;
      if (typeof override !== 'object') return fail('override must be an object or null');
      if (override.styles) {
        for (const bp of BREAKPOINTS) {
          const styles = override.styles[bp];
          if (!styles) continue;
          const result = validateStylePatch(styles as StyleProps);
          if (!result.ok) return result;
        }
      }
      if (override.props) {
        const result = validatePropPatch(override.props);
        if (!result.ok) return result;
      }
      if (override.motion !== undefined && override.motion !== null) {
        const result = validateMotion(override.motion);
        if (!result.ok) return result;
      }
      if (override.text !== undefined && typeof override.text !== 'string') {
        return fail('override text must be a string');
      }
      return ok;
    }

    default: {
      const exhaustive: never = command;
      return fail(`unknown command ${JSON.stringify(exhaustive)}`);
    }
  }
}


/**
 * Design tokens a `SET_THEME` command may write.
 *
 * Listed rather than derived from the type, because a validator that trusts
 * `Object.keys` of an interface is a validator that trusts whatever shape it
 * was handed.
 */
const THEME_KEYS: ReadonlySet<string> = new Set([
  'background',
  'surface',
  'text',
  'textMuted',
  'accent',
  'accentText',
  'border',
  'fontDisplay',
  'fontBody',
]);

const EASING_NAME_SET: ReadonlySet<string> = new Set(Object.keys(EASING_CSS));
const EFFECT_SET: ReadonlySet<string> = new Set(ENTRANCE_EFFECTS as readonly string[]);

function inRange(value: unknown, limit: { min: number; max: number }): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= limit.min && value <= limit.max;
}

/**
 * Motion is numbers and enums, so validation is exhaustive rather than
 * best-effort: an out-of-range duration is rejected here instead of being
 * clamped silently in the CSS generator, where nobody would ever see it.
 */
/** Every breakpoint's styles on one node. */
function validateNodeStyles(node: { styles: Record<string, unknown> }): ValidationResult {
  for (const bp of BREAKPOINTS) {
    const styles = node.styles[bp];
    if (!styles) continue;
    const result = validateStylePatch(styles as StyleProps);
    if (!result.ok) return result;
  }
  return ok;
}

export function validateMotion(motion: NodeMotion): ValidationResult {
  if (typeof motion !== 'object' || motion === null) return fail('motion must be an object');

  const entrance = motion.entrance;
  if (entrance !== undefined) {
    if (!EFFECT_SET.has(entrance.effect as EntranceEffect)) {
      return fail(`unknown entrance effect "${String(entrance.effect)}"`);
    }
    if (!EASING_NAME_SET.has(entrance.easing as EasingName)) {
      return fail(`unknown easing "${String(entrance.easing)}"`);
    }
    if (entrance.trigger !== 'load' && entrance.trigger !== 'scroll') {
      return fail('entrance trigger must be load or scroll');
    }
    if (!inRange(entrance.duration, MOTION_LIMITS.duration)) return fail('entrance duration is out of range');
    if (!inRange(entrance.delay, MOTION_LIMITS.delay)) return fail('entrance delay is out of range');
    if (entrance.distance !== undefined && !inRange(entrance.distance, MOTION_LIMITS.distance)) {
      return fail('entrance distance is out of range');
    }
    if (entrance.stagger !== undefined && !inRange(entrance.stagger, MOTION_LIMITS.stagger)) {
      return fail('stagger is out of range');
    }
  }

  const hover = motion.hover;
  if (hover !== undefined) {
    if (!EASING_NAME_SET.has(hover.easing as EasingName)) return fail(`unknown easing "${String(hover.easing)}"`);
    if (!inRange(hover.duration, MOTION_LIMITS.duration)) return fail('hover duration is out of range');
    if (hover.lift !== undefined && !inRange(hover.lift, MOTION_LIMITS.lift)) return fail('hover lift is out of range');
    if (hover.scale !== undefined && !inRange(hover.scale, MOTION_LIMITS.scale)) return fail('hover scale is out of range');
    if (hover.opacity !== undefined && !inRange(hover.opacity, MOTION_LIMITS.opacity)) {
      return fail('hover opacity is out of range');
    }
    for (const key of ['backgroundColor', 'color', 'borderColor', 'boxShadow'] as const) {
      const value = hover[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') return fail(`hover ${key} must be a string`);
      if (!isSafeCssValue(value)) return fail(`hover ${key} contains an unsafe value`);
    }
  }

  const press = motion.press;
  if (press !== undefined && !inRange(press.scale, MOTION_LIMITS.scale)) {
    return fail('press scale is out of range');
  }

  return ok;
}
