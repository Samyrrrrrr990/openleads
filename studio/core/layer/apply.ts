/**
 * Applying and unapplying a Layer patch.
 *
 * Every application records what it replaced, so "Zory off" is an exact
 * restoration rather than a page reload and a hope. That record lives in
 * memory only — it describes this document, and it would be meaningless on the
 * next one.
 *
 * Nothing here trusts the patch. A patch may have been written by an older
 * version of Zory, hand-edited in storage, or installed from a package
 * somebody else published, so the validator runs on every application rather
 * than only at the point the patch was created.
 */

import type { PatchOutcome, ZoryLayerCommand, ZoryPatch } from './types';
import {
  isAllowedAttribute,
  isAllowedStyleProperty,
  isSafeStyleValue,
} from './types';
import { CONFIDENT, isForbiddenElement, resolveTarget } from './target';

/** What the element looked like before a patch touched it. */
interface Restore {
  patchId: string;
  element: Element;
  undo: () => void;
}

export function validateLayerCommand(command: ZoryLayerCommand): { ok: true } | { ok: false; detail: string } {
  switch (command.type) {
    case 'SET_TEXT':
      if (typeof command.text !== 'string') return { ok: false, detail: 'Text must be a string.' };
      if (command.text.length > 2000) return { ok: false, detail: 'That text is too long to patch in.' };
      return { ok: true };

    case 'SET_STYLE': {
      if (!command.styles || typeof command.styles !== 'object') {
        return { ok: false, detail: 'Styles must be an object.' };
      }
      const entries = Object.entries(command.styles);
      if (entries.length > 40) return { ok: false, detail: 'Too many style properties in one patch.' };
      for (const [property, value] of entries) {
        if (!isAllowedStyleProperty(property)) {
          return { ok: false, detail: `Zory Layer does not set ${property}.` };
        }
        if (typeof value !== 'string' || !isSafeStyleValue(value)) {
          return { ok: false, detail: `That value for ${property} is not allowed.` };
        }
      }
      return { ok: true };
    }

    case 'SET_ATTRIBUTE':
      if (!isAllowedAttribute(command.name)) {
        return { ok: false, detail: `Zory Layer does not set the ${command.name} attribute.` };
      }
      if (command.value !== null && (typeof command.value !== 'string' || command.value.length > 500)) {
        return { ok: false, detail: 'That attribute value is not allowed.' };
      }
      return { ok: true };

    case 'HIDE_ELEMENT':
    case 'SHOW_ELEMENT':
      return { ok: true };

    case 'MOVE_ELEMENT':
      if (command.direction !== 'up' && command.direction !== 'down') {
        return { ok: false, detail: 'A move is either up or down.' };
      }
      return { ok: true };

    default:
      return { ok: false, detail: 'Unknown patch command.' };
  }
}

function camelToKebab(property: string): string {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function applyCommandTo(element: Element, command: ZoryLayerCommand): (() => void) | null {
  switch (command.type) {
    case 'SET_TEXT': {
      const previous = element.textContent;
      // textContent, never innerHTML: a patch is data, and this is the line
      // that keeps it that way even if the text contains markup.
      element.textContent = command.text;
      return () => {
        element.textContent = previous;
      };
    }

    case 'SET_STYLE': {
      const style = (element as HTMLElement).style;
      if (!style) return null;
      const previous: [string, string, string][] = [];
      for (const [property, value] of Object.entries(command.styles)) {
        const name = camelToKebab(property);
        previous.push([name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
        // `important` so a patch is not lost to a more specific site rule.
        style.setProperty(name, value, 'important');
      }
      return () => {
        for (const [name, value, priority] of previous) {
          if (value === '') style.removeProperty(name);
          else style.setProperty(name, value, priority);
        }
      };
    }

    case 'SET_ATTRIBUTE': {
      const had = element.hasAttribute(command.name);
      const previous = element.getAttribute(command.name);
      if (command.value === null) element.removeAttribute(command.name);
      else element.setAttribute(command.name, command.value);
      return () => {
        if (had && previous !== null) element.setAttribute(command.name, previous);
        else element.removeAttribute(command.name);
      };
    }

    case 'HIDE_ELEMENT': {
      const style = (element as HTMLElement).style;
      if (!style) return null;
      const previous = style.getPropertyValue('display');
      const priority = style.getPropertyPriority('display');
      style.setProperty('display', 'none', 'important');
      return () => {
        if (previous === '') style.removeProperty('display');
        else style.setProperty('display', previous, priority);
      };
    }

    case 'SHOW_ELEMENT': {
      const style = (element as HTMLElement).style;
      if (!style) return null;
      const previous = style.getPropertyValue('display');
      const priority = style.getPropertyPriority('display');
      style.setProperty('display', 'revert', 'important');
      return () => {
        if (previous === '') style.removeProperty('display');
        else style.setProperty('display', previous, priority);
      };
    }

    case 'MOVE_ELEMENT': {
      const parent = element.parentElement;
      if (!parent) return null;
      const before = element.nextElementSibling;
      const sibling =
        command.direction === 'up' ? element.previousElementSibling : element.nextElementSibling;
      if (!sibling) return null;

      if (command.direction === 'up') parent.insertBefore(element, sibling);
      else parent.insertBefore(sibling, element);

      return () => {
        if (before) parent.insertBefore(element, before);
        else parent.append(element);
      };
    }

    default:
      return null;
  }
}

/**
 * Applies one patch to a document.
 *
 * Returns the outcome and, on success, the exact undo for it. Callers keep
 * those undos so that turning Zory off restores the page rather than reloading
 * it, which matters on a page holding unsaved state.
 */
export function applyPatch(
  root: ParentNode,
  patch: ZoryPatch,
): { outcome: PatchOutcome; restore: Restore | null } {
  const valid = validateLayerCommand(patch.command);
  if (!valid.ok) {
    return { outcome: { ok: false, reason: 'invalid', detail: valid.detail }, restore: null };
  }

  const resolution = resolveTarget(root, patch.target);
  if (!resolution.element) {
    return { outcome: { ok: false, reason: 'not-found' }, restore: null };
  }
  if (isForbiddenElement(resolution.element)) {
    return { outcome: { ok: false, reason: 'forbidden' }, restore: null };
  }
  if (resolution.ties > 1) {
    return { outcome: { ok: false, reason: 'ambiguous', matches: resolution.ties }, restore: null };
  }
  if (resolution.confidence < CONFIDENT) {
    return {
      outcome: { ok: false, reason: 'low-confidence', confidence: resolution.confidence },
      restore: null,
    };
  }

  const undo = applyCommandTo(resolution.element, patch.command);
  if (!undo) {
    return {
      outcome: { ok: false, reason: 'invalid', detail: 'This change cannot apply to that element.' },
      restore: null,
    };
  }

  return {
    outcome: { ok: true, confidence: resolution.confidence },
    restore: { patchId: patch.id, element: resolution.element, undo },
  };
}

export type { Restore };

/** True when the patch's scope covers this location. */
export function scopeMatches(patch: ZoryPatch, origin: string, pathname: string): boolean {
  if (patch.scope.origin !== origin) return false;
  switch (patch.scope.routeMatch) {
    case 'origin':
      return true;
    case 'prefix':
      return patch.scope.route ? pathname.startsWith(patch.scope.route) : true;
    case 'exact':
      return patch.scope.route ? pathname === patch.scope.route : true;
    default:
      return false;
  }
}
