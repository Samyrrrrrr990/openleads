/**
 * The blocks a model is allowed to insert.
 *
 * A deliberately small, closed catalogue. The model names a block; Zory builds
 * it. That inversion is the whole design, and it exists for one reason: a real
 * INSERT_NODE carries node ids, and a model that invents ids can collide with
 * live nodes, orphan a subtree or overwrite something. Naming a block is a
 * request with no ids in it at all, so the dangerous part of the command is
 * constructed here from known-good material.
 *
 * It also keeps the AI honest about what the product can build. A model asked
 * for a "testimonial carousel" will happily emit one; a closed catalogue makes
 * it compose what actually exists instead of describing something that does
 * not.
 */

import type { NodeBlueprint } from '@zory/core';

export interface BlockDefinition {
  /** Name the model uses. Short, and describing the outcome, not the markup. */
  id: string;
  /** One line for the prompt, so the model knows when to reach for it. */
  summary: string;
  build: (text?: string) => NodeBlueprint;
}

const SECTION_STYLES = {
  base: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '16px',
    paddingTop: '64px',
    paddingBottom: '64px',
    paddingLeft: '24px',
    paddingRight: '24px',
  },
};

export const BLOCKS: BlockDefinition[] = [
  {
    id: 'section',
    summary: 'An empty vertical section. Use as a container for other blocks.',
    build: () => ({
      kind: 'container',
      name: 'Section',
      props: { tag: 'section' },
      styles: SECTION_STYLES,
      children: [],
    }),
  },
  {
    id: 'heading',
    summary: 'A heading. Pass the wording as `text`.',
    build: (text) => ({
      kind: 'heading',
      name: 'Heading',
      text: text ?? 'Heading',
      props: { level: 2 },
      styles: { base: { fontSize: '36px', fontWeight: '600', letterSpacing: '-0.02em' } },
      children: [],
    }),
  },
  {
    id: 'paragraph',
    summary: 'A block of body copy. Pass the wording as `text`.',
    build: (text) => ({
      kind: 'text',
      name: 'Text',
      text: text ?? 'Text',
      styles: { base: { fontSize: '16px', lineHeight: '1.6', maxWidth: '60ch' } },
      children: [],
    }),
  },
  {
    id: 'button',
    summary: 'A call to action. Pass the label as `text`.',
    build: (text) => ({
      kind: 'button',
      name: 'Button',
      text: text ?? 'Get started',
      styles: {
        base: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: '12px',
          paddingBottom: '12px',
          paddingLeft: '20px',
          paddingRight: '20px',
          borderRadius: '8px',
          backgroundColor: '#111111',
          color: '#ffffff',
          fontWeight: '500',
        },
      },
      children: [],
    }),
  },
  {
    id: 'row',
    summary: 'A horizontal row. Use to place buttons or cards side by side.',
    build: () => ({
      kind: 'container',
      name: 'Row',
      styles: { base: { display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center' } },
      children: [],
    }),
  },
  {
    id: 'grid',
    summary: 'A three-column grid. Use for feature or pricing cards.',
    build: () => ({
      kind: 'container',
      name: 'Grid',
      styles: {
        base: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' },
      },
      children: [],
    }),
  },
  {
    id: 'card',
    summary: 'A bordered card with a heading and a line of copy.',
    build: (text) => ({
      kind: 'container',
      name: 'Card',
      styles: {
        base: {
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          paddingTop: '20px',
          paddingBottom: '20px',
          paddingLeft: '20px',
          paddingRight: '20px',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: '#e5e5e5',
          borderRadius: '12px',
        },
      },
      children: [
        {
          kind: 'heading',
          name: 'Card title',
          text: text ?? 'Card title',
          props: { level: 3 },
          styles: { base: { fontSize: '18px', fontWeight: '600' } },
          children: [],
        },
        {
          kind: 'text',
          name: 'Card body',
          text: 'Describe this in a sentence.',
          styles: { base: { fontSize: '15px', lineHeight: '1.6' } },
          children: [],
        },
      ],
    }),
  },
  {
    id: 'divider',
    summary: 'A horizontal rule between sections.',
    build: () => ({
      kind: 'divider',
      name: 'Divider',
      styles: { base: { borderWidth: '1px', borderStyle: 'solid', borderColor: '#e5e5e5' } },
      children: [],
    }),
  },
];

export function findBlock(id: string): BlockDefinition | undefined {
  return BLOCKS.find((block) => block.id === id);
}

/** The catalogue, formatted for the system prompt. */
export function blockCatalogue(): string {
  return BLOCKS.map((block) => `  "${block.id}" — ${block.summary}`).join('\n');
}
