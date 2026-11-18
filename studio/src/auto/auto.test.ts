import { describe, expect, it } from 'vitest';

import { applyCopyReply, build, copyNodes, copyRequest, displayPhone, pickTemplate, proposeChange, render, type LeadBrief } from './index';

const lead: LeadBrief = {
  email: 'hello@brightspark.ca',
  business: 'Bright Spark Electrical',
  contact: 'Dana Moss',
  city: 'Toronto',
  phone: '416 555 0199',
  website: 'https://brightspark.ca',
  industry: 'Electrician',
  address: '',
};

describe('picking a template', () => {
  it.each([
    [{ industry: 'Electrician', business: '' }, 'hollis'],
    [{ industry: '', business: 'Smile Dental Clinic' }, 'alderwood'],
    [{ industry: 'Roofing contractor', business: '' }, 'marshvale'],
    [{ industry: 'Coffee shop', business: '' }, 'pennyroyal'],
    [{ industry: 'Hair salon', business: '' }, 'foldstudio'],
    [{ industry: '', business: 'Acme Ltd' }, 'tallow'],
  ])('%o → %s', (brief, id) => {
    expect(pickTemplate(brief).id).toBe(id);
  });
});

describe('building for a lead', () => {
  const { project, notes } = build(lead, 'hollis');
  const texts = copyNodes(project).map((n) => n.text).join('\n');

  it('puts their name, phone and city on it', () => {
    expect(texts).toContain('Bright Spark Electrical');
    expect(texts).not.toContain('Hollis Electric');
    expect(texts).toContain('(416) 555-0199');
    expect(texts).not.toContain('07700 900412');
    expect(texts).toContain('Toronto');
    expect(texts).not.toMatch(/\bLeeds\b/);
    expect(notes[0]).toContain('Bright Spark Electrical');
  });

  it('points any call links at their number', () => {
    for (const id of ['hollis', 'tallow', 'harborline']) {
      const tel = copyNodes(build(lead, id).project).filter((n) => n.href?.startsWith('tel:'));
      expect(tel.every((n) => n.href === 'tel:4165550199')).toBe(true);
    }
  });

  it('renders every page', () => {
    const html = render(project)!;
    expect(Object.keys(html)).toContain('/');
    expect(html['/']).toContain('Bright Spark Electrical');
  });

  it('asks the model about every text, with the facts', () => {
    const { system, user } = copyRequest(project, lead);
    expect(system).toContain('Never write a review');
    expect(user).toContain('"business":"Bright Spark Electrical"');
    expect(user).toContain(copyNodes(project)[0]!.id);
  });
});

describe("applying the model's copy", () => {
  const { project } = build(lead, 'hollis');
  const [first, second] = copyNodes(project).filter((n) => n.text);

  it('keeps valid text changes and refuses the rest', () => {
    const reply = '```json\n' + JSON.stringify([
      { type: 'SET_TEXT', nodeId: first!.id, text: 'Licensed electricians in Toronto' },
      { type: 'SET_TEXT', nodeId: 'n_doesnotexist', text: 'x' },
      { type: 'DELETE_NODE', nodeId: second!.id },
      { type: 'SET_PROP', nodeId: second!.id, patch: { href: 'javascript:alert(1)' } },
    ]) + '\n```';
    const out = applyCopyReply(project, reply);
    expect(out.changes).toHaveLength(1);
    expect(out.skipped).toHaveLength(1);
    expect(copyNodes(out.project).find((n) => n.id === first!.id)?.text).toBe('Licensed electricians in Toronto');
    expect(copyNodes(out.project).find((n) => n.id === second!.id)).toBeTruthy();
  });

  it('says so when the reply is not a list', () => {
    expect(() => applyCopyReply(project, 'Sorry, I cannot help')).toThrow();
  });
});

describe('phone numbers', () => {
  it.each([
    ['+15124520888', '(512) 452-0888'],
    ['512 452 0888', '(512) 452-0888'],
    ['+44 20 7946 0332', '+44 20 7946 0332'],
  ])('%s → %s', (raw, shown) => expect(displayPhone(raw)).toBe(shown));
});

describe('free-form changes', () => {
  const { project } = build(lead, 'hollis');
  const first = copyNodes(project).find((n) => n.kind === 'heading')!;

  it('go to the model first when there is one', async () => {
    let asked = 0;
    const out = await proposeChange(project, 'make the headline punchier', async () => {
      asked++;
      return JSON.stringify([{ type: 'SET_TEXT', nodeId: first.id, text: 'Sparks fixed fast.' }]);
    });
    expect(asked).toBe(1);
    expect(out.by).toBe('model');
    expect(copyNodes(out.project).find((n) => n.id === first.id)?.text).toBe('Sparks fixed fast.');
  });

  it('fall back to the rules when the model fails', async () => {
    const out = await proposeChange(project, 'make it calmer', async () => {
      throw new Error('offline');
    });
    expect(out.by).toBe('rules');
    expect(out.changes.length).toBeGreaterThan(0);
  });

  it('use the rules alone without a model', async () => {
    const out = await proposeChange(project, 'make it calmer', null);
    expect(out.by).toBe('rules');
  });
});
