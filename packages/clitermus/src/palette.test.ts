import { describe, expect, it } from 'vitest';
import { CommandPalette } from './palette.js';
import { damerauLevenshtein, levenshtein } from './distance.js';

const SPECS = [
  { name: 'ml exec', description: 'one-shot prompt' },
  { name: 'ml chat', description: 'stream chat' },
  { name: 'health api', description: 'check api' },
  { name: 'health web', description: 'check web' },
  { name: 'health all', description: 'check all' },
  { name: 'spec status', description: 'feature status' },
];

describe('distance', () => {
  it('levenshtein matches known cases', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
  it('damerauLevenshtein counts transposition as one', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('exec', 'exce')).toBe(1);
  });
});

describe('CommandPalette', () => {
  it('returns prefix matches first', () => {
    const p = new CommandPalette(SPECS);
    const matches = p.getMatches('ml');
    expect(matches[0]?.name.startsWith('ml')).toBe(true);
    expect(matches.some((m) => m.name === 'ml exec')).toBe(true);
    expect(matches.some((m) => m.name === 'ml chat')).toBe(true);
  });

  it('handles partial second-token typing', () => {
    const p = new CommandPalette(SPECS);
    const matches = p.getMatches('ml ex');
    expect(matches[0]?.name).toBe('ml exec');
    expect(matches[0]?.ghostSuffix).toBe('ec');
  });

  it('caches by typed input', () => {
    const p = new CommandPalette(SPECS);
    const a = p.getMatches('ml');
    const b = p.getMatches('ml');
    expect(a).toBe(b);
  });

  it('didYouMean corrects a typo within threshold', () => {
    const p = new CommandPalette(SPECS);
    expect(p.didYouMean('ml exce')).toBe('ml exec');
    expect(p.didYouMean('helth api')).toBe('health api');
  });

  it('didYouMean returns null for far-off input', () => {
    const p = new CommandPalette(SPECS);
    expect(p.didYouMean('zzz')).toBe(null);
  });

  it('getDomainCommands lists by first token', () => {
    const p = new CommandPalette(SPECS);
    expect(p.getDomainCommands('health').sort()).toEqual([
      'health all',
      'health api',
      'health web',
    ]);
    expect(p.getDomainCommands('ml').sort()).toEqual(['ml chat', 'ml exec']);
  });

  it('moveSelection wraps', () => {
    const p = new CommandPalette(SPECS);
    p.getMatches('ml');
    expect(p.getSelectedIndex()).toBe(0);
    p.moveSelection('up', 2);
    expect(p.getSelectedIndex()).toBe(1);
    p.moveSelection('down', 2);
    expect(p.getSelectedIndex()).toBe(0);
  });

  it('excludes exact full match', () => {
    const p = new CommandPalette(SPECS);
    const m = p.getMatches('ml exec');
    expect(m.find((x) => x.name === 'ml exec')).toBeUndefined();
  });
});
