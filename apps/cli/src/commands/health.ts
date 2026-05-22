import type { CommandContext } from '@jameswomack/clitermus';

interface Target {
  name: string;
  url: string;
}

const API_URL = process.env.API_HEALTH_URL ?? `http://localhost:${process.env.API_PORT ?? '3000'}/health`;
const WEB_URL = process.env.WEB_HEALTH_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3001'}`;

async function check({ name, url }: Target, ctx: CommandContext): Promise<boolean> {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3_000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (res.ok) {
      ctx.log(`{green-fg}✓ ${name}{/green-fg}  {gray-fg}${url} (${res.status}, ${ms} ms){/gray-fg}`);
      return true;
    }
    ctx.log(`{yellow-fg}⚠ ${name}{/yellow-fg}  ${url} responded ${res.status}`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`{red-fg}✗ ${name}{/red-fg}  ${url}  {gray-fg}${msg}{/gray-fg}`);
    return false;
  }
}

export async function healthApi(ctx: CommandContext): Promise<void> {
  await check({ name: 'api', url: API_URL }, ctx);
}

export async function healthWeb(ctx: CommandContext): Promise<void> {
  await check({ name: 'web', url: WEB_URL }, ctx);
}

export async function healthAll(ctx: CommandContext): Promise<void> {
  await check({ name: 'api', url: API_URL }, ctx);
  await check({ name: 'web', url: WEB_URL }, ctx);
}
