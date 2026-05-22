import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { History } from './history.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clitermus-hist-'));
  file = join(dir, 'history');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('History', () => {
  it('persists entries to disk', () => {
    const h = new History({ file });
    h.push('/ml exec foo');
    h.push('/ml exec bar');
    expect(readFileSync(file, 'utf-8').trim().split('\n')).toEqual([
      '/ml exec foo',
      '/ml exec bar',
    ]);
  });

  it('deduplicates immediately repeated entries', () => {
    const h = new History({ file });
    h.push('a');
    h.push('a');
    h.push('b');
    h.push('a');
    expect(h.all()).toEqual(['a', 'b', 'a']);
  });

  it('respects max', () => {
    const h = new History({ file, max: 3 });
    h.push('1');
    h.push('2');
    h.push('3');
    h.push('4');
    expect(h.all()).toEqual(['2', '3', '4']);
  });

  it('up/down cycles through entries', () => {
    const h = new History({ file });
    h.push('one');
    h.push('two');
    h.push('three');

    h.beginBrowse('');
    expect(h.up('')).toBe('three');
    expect(h.up('')).toBe('two');
    expect(h.up('')).toBe('one');
    expect(h.up('')).toBe(null);
    expect(h.down('')).toBe('two');
    expect(h.down('')).toBe('three');
    // walking past newest returns the saved input
    expect(h.down('')).toBe('');
  });

  it('filters by prefix on up()', () => {
    const h = new History({ file });
    h.push('/ml exec a');
    h.push('/health api');
    h.push('/ml exec b');
    h.beginBrowse('/ml');
    expect(h.up('/ml')).toBe('/ml exec b');
    expect(h.up('/ml')).toBe('/ml exec a');
    expect(h.up('/ml')).toBe(null);
  });

  it('loads existing history from disk', () => {
    const h1 = new History({ file });
    h1.push('alpha');
    h1.push('beta');
    const h2 = new History({ file });
    expect(h2.all()).toEqual(['alpha', 'beta']);
  });
});
