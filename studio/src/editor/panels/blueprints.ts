/**
 * The insert palette.
 *
 * Each entry is a blueprint that goes through INSERT_NODE like any other edit,
 * so inserting is undoable and exportable with no special casing.
 *
 * Defaults are deliberately opinionated: an inserted element should look
 * placed, not like an unstyled browser default a user has to repair.
 */

import type { NodeBlueprint, NodeKind } from '@zory/core';

export interface PaletteEntry {
  id: string;
  label: string;
  kind: NodeKind;
  blueprint: NodeBlueprint;
}

export const PALETTE: PaletteEntry[] = [
  {
    id: 'section',
    label: 'Section',
    kind: 'container',
    blueprint: {
      kind: 'container',
      name: 'Section',
      props: { tag: 'section' },
      styles: {
        base: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          width: '100%',
          paddingTop: '80px',
          paddingRight: '32px',
          paddingBottom: '80px',
          paddingLeft: '32px',
        },
        mobile: { paddingTop: '48px', paddingBottom: '48px', paddingRight: '20px', paddingLeft: '20px' },
      },
      children: [
        {
          kind: 'heading',
          name: 'Section title',
          text: 'Section title',
          props: { level: 2 },
          styles: {
            base: { fontSize: '32px', fontWeight: '600', letterSpacing: '-0.02em', lineHeight: '1.15' },
            mobile: { fontSize: '25px' },
          },
        },
        {
          kind: 'text',
          name: 'Section body',
          text: 'Describe what this section is for. Select the text and type over it.',
          styles: { base: { fontSize: '16px', lineHeight: '1.6', maxWidth: '58ch', opacity: 0.75 } },
        },
      ],
    },
  },
  {
    id: 'stack',
    label: 'Stack',
    kind: 'container',
    blueprint: {
      kind: 'container',
      name: 'Stack',
      styles: {
        base: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', minHeight: '48px' },
      },
    },
  },
  {
    id: 'row',
    label: 'Row',
    kind: 'container',
    blueprint: {
      kind: 'container',
      name: 'Row',
      styles: {
        base: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          minHeight: '48px',
        },
        mobile: { flexDirection: 'column', alignItems: 'flex-start' },
      },
    },
  },
  {
    id: 'grid',
    label: 'Grid',
    kind: 'container',
    blueprint: {
      kind: 'container',
      name: 'Grid',
      styles: {
        base: {
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '16px',
          width: '100%',
          minHeight: '48px',
        },
        tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
      },
    },
  },
  {
    id: 'heading',
    label: 'Heading',
    kind: 'heading',
    blueprint: {
      kind: 'heading',
      name: 'Heading',
      text: 'A new heading',
      props: { level: 2 },
      styles: {
        base: { fontSize: '32px', fontWeight: '600', lineHeight: '1.15', letterSpacing: '-0.02em' },
        mobile: { fontSize: '25px' },
      },
    },
  },
  {
    id: 'text',
    label: 'Text',
    kind: 'text',
    blueprint: {
      kind: 'text',
      name: 'Text',
      text: 'Write something here.',
      styles: { base: { fontSize: '16px', lineHeight: '1.6', maxWidth: '62ch' } },
    },
  },
  {
    id: 'button',
    label: 'Button',
    kind: 'button',
    blueprint: {
      kind: 'button',
      name: 'Button',
      text: 'Button',
      styles: {
        base: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 'fit-content',
          paddingTop: '11px',
          paddingRight: '20px',
          paddingBottom: '11px',
          paddingLeft: '20px',
          backgroundColor: '#14171c',
          color: '#ffffff',
          borderRadius: '8px',
          fontSize: '15px',
          fontWeight: '550',
        },
      },
    },
  },
  {
    id: 'link',
    label: 'Link',
    kind: 'link',
    blueprint: {
      kind: 'link',
      name: 'Link',
      text: 'Link text',
      props: { href: '#' },
      styles: { base: { fontSize: '15px', width: 'fit-content' } },
    },
  },
  {
    id: 'image',
    label: 'Image',
    kind: 'image',
    blueprint: {
      kind: 'image',
      name: 'Image',
      props: { src: '', alt: '' },
      styles: {
        base: {
          width: '100%',
          maxWidth: '480px',
          minHeight: '180px',
          backgroundColor: '#eceef1',
          borderRadius: '8px',
          objectFit: 'cover',
        },
      },
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    kind: 'divider',
    blueprint: {
      kind: 'divider',
      name: 'Divider',
      styles: {
        base: {
          width: '100%',
          minHeight: '1px',
          backgroundColor: '#e4e7ec',
          borderStyle: 'none',
          marginTop: '8px',
          marginBottom: '8px',
        },
      },
    },
  },
];
