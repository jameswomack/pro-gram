import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = await import('node:child_process');
const { generate } = await import('./generate.js');

function fakeProc(stdoutText: string, stderrText = '', exitCode = 0): EventEmitter {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  setImmediate(() => {
    proc.stdout.end(stdoutText);
    proc.stderr.end(stderrText);
    proc.emit('exit', exitCode);
  });
  return proc;
}

describe('generate()', () => {
  afterEach(() => vi.clearAllMocks());

  it('strips the ===== banner from mlx_lm.generate output', async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      fakeProc('==========\nthe answer is 42\n==========\nPrompt: 5 tokens\n') as never,
    );

    const r = await generate('q?', { model: 'm' });
    expect(r.text).toBe('the answer is 42');
    expect(r.exitCode).toBe(0);
  });

  it('passes max-tokens/temp/top-p args', async () => {
    vi.mocked(spawn).mockReturnValueOnce(fakeProc('==========\nhi\n==========\n') as never);

    await generate('p', { model: 'm', max_tokens: 128, temperature: 0.1, top_p: 0.9 });
    const args = vi.mocked(spawn).mock.calls[0]![1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        '-m', 'mlx_lm.generate',
        '--model', 'm',
        '--prompt', 'p',
        '--max-tokens', '128',
        '--temp', '0.1',
        '--top-p', '0.9',
      ]),
    );
  });

  it('rejects when aborted', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn(() => {
        setImmediate(() => proc.emit('exit', null));
      });
      return proc as never;
    });

    const ac = new AbortController();
    const p = generate('p', { model: 'm', signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });
});
