/**
 * Human-readable command descriptions.
 *
 * Used for undo labels, the Intent proposal preview and the command ledger.
 * Descriptions are written from the user's side of the screen: they name what
 * changed, not which reducer ran.
 */

import type { Project, StyleKey } from '../graph/types';
import { BREAKPOINT_LABEL } from '../graph/types';
import { findNode, nodeLabel } from '../graph/selectors';
import type { ZoryCommand } from './types';

const STYLE_LABEL: Partial<Record<StyleKey, string>> = {
  display: 'display',
  flexDirection: 'direction',
  alignItems: 'align',
  justifyContent: 'justify',
  flexWrap: 'wrap',
  gap: 'gap',
  gridTemplateColumns: 'columns',
  paddingTop: 'padding top',
  paddingRight: 'padding right',
  paddingBottom: 'padding bottom',
  paddingLeft: 'padding left',
  marginTop: 'margin top',
  marginRight: 'margin right',
  marginBottom: 'margin bottom',
  marginLeft: 'margin left',
  width: 'width',
  maxWidth: 'max width',
  minHeight: 'min height',
  height: 'height',
  fontFamily: 'font',
  fontSize: 'size',
  fontWeight: 'weight',
  lineHeight: 'line height',
  letterSpacing: 'tracking',
  textAlign: 'text align',
  textTransform: 'text case',
  color: 'colour',
  backgroundColor: 'background',
  backgroundImage: 'background image',
  borderWidth: 'border width',
  borderStyle: 'border style',
  borderColor: 'border colour',
  borderRadius: 'radius',
  boxShadow: 'shadow',
  opacity: 'opacity',
  objectFit: 'fit',
};

export function styleLabel(key: string): string {
  return STYLE_LABEL[key as StyleKey] ?? key;
}

function targetName(project: Project, nodeId: string): string {
  const node = findNode(project, nodeId);
  return node ? nodeLabel(node) : 'element';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'default';
  if (typeof value === 'number') return String(value);
  return String(value);
}

/** One-line summary, e.g. `Set size to 72px on Hero title`. */
export function describeCommand(project: Project, command: ZoryCommand): string {
  switch (command.type) {
    case 'SET_TEXT':
      return `Edit text on ${targetName(project, command.nodeId)}`;

    case 'SET_STYLE': {
      const keys = Object.keys(command.patch);
      const scope = command.breakpoint === 'base' ? '' : ` on ${BREAKPOINT_LABEL[command.breakpoint].toLowerCase()}`;
      const name = targetName(project, command.nodeId);
      if (keys.length === 1) {
        const key = keys[0]!;
        const value = (command.patch as Record<string, unknown>)[key];
        return `Set ${styleLabel(key)} to ${formatValue(value)} on ${name}${scope}`;
      }
      return `Update ${keys.length} style properties on ${name}${scope}`;
    }

    case 'SET_PROP': {
      const keys = Object.keys(command.patch);
      return `Update ${keys.map(styleLabel).join(', ')} on ${targetName(project, command.nodeId)}`;
    }

    case 'SET_MOTION': {
      const name = targetName(project, command.nodeId);
      if (command.motion === null) return `Remove motion from ${name}`;
      const parts: string[] = [];
      if (command.motion.entrance) parts.push(command.motion.entrance.effect.replace('-', ' '));
      if (command.motion.hover) parts.push('hover');
      if (command.motion.press) parts.push('press');
      return parts.length > 0 ? `Set ${parts.join(' and ')} motion on ${name}` : `Set motion on ${name}`;
    }

    case 'SET_THEME': {
      const keys = Object.keys(command.patch);
      if (keys.length === 1) return `Set ${styleLabel(keys[0]!)} for the whole project`;
      return `Update ${keys.length} design tokens`;
    }

    case 'RENAME_NODE':
      return `Rename layer to ${command.name}`;

    case 'SET_PROJECT_NAME':
      return `Rename project to ${command.name}`;

    case 'INSERT_NODE': {
      const root = command.nodes.find((n) => n.id === command.rootId);
      return `Add ${root ? root.name : 'element'}`;
    }

    case 'DELETE_NODE':
      return `Delete ${targetName(project, command.nodeId)}`;

    case 'MOVE_NODE':
      return `Move ${targetName(project, command.nodeId)}`;

    case 'DUPLICATE_NODE':
      return `Duplicate ${targetName(project, command.nodeId)}`;

    case 'ADD_ASSET':
      return `Add image ${command.asset.name}`;

    case 'REMOVE_ASSET':
      return 'Remove image';

    case 'CREATE_COMPONENT':
      return `Create component ${command.def.name}`;

    case 'DELETE_COMPONENT':
      return `Delete component ${command.def.name}`;

    case 'SET_OVERRIDE':
      return command.override === null
        ? `Reset ${targetName(project, command.nodeId)} to the component`
        : `Change ${targetName(project, command.nodeId)}`;

    default: {
      const exhaustive: never = command;
      return `Unknown change ${JSON.stringify(exhaustive)}`;
    }
  }
}

/** Structured form for the command ledger: `SET_STYLE · Hero title · size 56px`. */
export interface LedgerEntry {
  type: string;
  target: string;
  detail: string;
}

