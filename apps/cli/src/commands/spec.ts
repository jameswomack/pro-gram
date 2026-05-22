import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { CommandContext } from '@jameswomack/clitermus';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(HERE, '../../../../.ai/SPEC.md');

/**
 * /spec status — parse feature rows from .ai/SPEC.md and tally by status.
 */
export async function specStatus(ctx: CommandContext): Promise<void> {
  let text: string;
  try {
    text = await readFile(SPEC_PATH, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`{red-fg}Could not read SPEC.md at ${SPEC_PATH}: ${msg}{/red-fg}`);
    return;
  }

  const counts: Record<string, number> = {};
  const rows: { id: string; feature: string; status: string }[] = [];
  // Match table rows like: | F-001 | Name | `[SHIPPED]` | ...
  const rowRe = /^\|\s*(F-\d{3})\s*\|\s*([^|]+?)\s*\|\s*`\[(\w+)\]`/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const [, id, feature, status] = m;
    rows.push({ id: id!, feature: feature!, status: status! });
    counts[status!] = (counts[status!] ?? 0) + 1;
  }

  if (rows.length === 0) {
    ctx.log('{gray-fg}No feature rows matched in SPEC.md.{/gray-fg}');
    return;
  }
  ctx.log(`{bold}Feature status across ${rows.length} entries:{/bold}`);
  for (const [status, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    ctx.log(`  {cyan-fg}${status.padEnd(12)}{/cyan-fg} ${n}`);
  }
  ctx.log('');
  for (const r of rows) {
    const color =
      r.status === 'SHIPPED' ? 'green-fg' :
      r.status === 'IN_PROGRESS' ? 'yellow-fg' :
      r.status === 'PARTIAL' ? 'yellow-fg' :
      'gray-fg';
    ctx.log(`  ${r.id}  {${color}}${r.status.padEnd(12)}{/${color}}  ${r.feature}`);
  }
}
