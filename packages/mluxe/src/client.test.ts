import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MluxeClient } from './client.js';

const MODEL = 'mlx-community/Qwen2.5-14B-Instruct-4bit';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('MluxeClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds baseUrl from host/port', () => {
    const c = new MluxeClient({ model: MODEL, host: '0.0.0.0', port: 9000 });
    expect(c.baseUrl).toBe('http://0.0.0.0:9000');
  });

  it('chat() parses content + usage from OpenAI-shaped response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: MODEL,
        choices: [{ message: { content: 'hello world' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );

    const c = new MluxeClient({ model: MODEL });
    const res = await c.chat([{ role: 'user', content: 'hi' }]);

    expect(res.content).toBe('hello world');
    expect(res.usage?.total_tokens).toBe(5);

    const call = fetchMock.mock.calls[0]!;
    const [url, init] = call;
    expect(url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(false);
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0.7);
  });

  it('chat() throws on non-OK status with body context', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    );
    const c = new MluxeClient({ model: MODEL });
    await expect(c.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/500/);
  });

  it('chatStream() yields deltas then done', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}],"model":"m"}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}],"model":"m"}\n',
        'data: [DONE]\n',
      ]),
    );

    const c = new MluxeClient({ model: MODEL });
    const out: string[] = [];
    let sawDone = false;
    for await (const chunk of c.chatStream([{ role: 'user', content: 'hi' }])) {
      if (chunk.done) sawDone = true;
      else out.push(chunk.delta);
    }
    expect(out.join('')).toBe('Hello');
    expect(sawDone).toBe(true);
  });

  it('chatStream() tolerates malformed lines and split chunks', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"A"',
        '}}],"model":"m"}\n',
        'data: not-json\n',
        'data: {"choices":[{"delta":{"content":"B"}}],"model":"m"}\n',
        'data: [DONE]\n',
      ]),
    );

    const c = new MluxeClient({ model: MODEL });
    const out: string[] = [];
    for await (const chunk of c.chatStream([{ role: 'user', content: 'hi' }])) {
      if (!chunk.done) out.push(chunk.delta);
    }
    expect(out.join('')).toBe('AB');
  });

  it('listModels() returns data array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: MODEL, object: 'model' }] }));
    const c = new MluxeClient({ model: MODEL });
    const models = await c.listModels();
    expect(models[0]?.id).toBe(MODEL);
  });

  it('isHealthy() returns false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const c = new MluxeClient({ model: MODEL });
    expect(await c.isHealthy()).toBe(false);
  });

  it('complete() posts to /v1/completions and returns text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ text: '42' }] }));
    const c = new MluxeClient({ model: MODEL });
    expect(await c.complete('answer:')).toBe('42');

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8080/v1/completions');
  });
});
