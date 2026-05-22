import type { CommandContext } from '@jameswomack/clitermus';
import {
  dirSizeBytes,
  downloadModel,
  fetchModelSize,
  formatBytes,
  isCachedComplete,
  modelCacheDir,
} from './hf-cache.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Rotating progress chatter, in the spirit of the Ballpark Genius `/import`
 * loop and Claude Code's status line — keeps the user company while the model
 * tarball trundles down the wire.
 */
const WHIMSY: readonly string[] = [
  'Reticulating quantized splines',
  'Warming up the unified memory',
  'Conjuring 4-bit attention heads',
  'Buttering the safetensors',
  'Polishing the Metal kernels',
  'Asking transformers nicely',
  'Bribing the gradient',
  'Discombobulating the tokenizer',
  'Phoning Cupertino for permission',
  'Convincing the silicon to cooperate',
  'Untangling the embedding matrix',
  'Folding spacetime around the weights',
  'Translating PyTorch into MLX',
  'Politely waiting for HuggingFace',
  'Stretching the context window',
  'Counting parameters by hand',
  'Defragmenting expectations',
  'Coaxing photons through fiber',
  'Negotiating with the bandwidth gods',
  'Inflating compressed dreams',
  'Marinating the activations',
  'Cataloging every last token',
  'Lubricating the residual stream',
  'Annealing the loss landscape',
];

function pickPython(): string {
  return process.env.MLUXE_PYTHON ?? 'python';
}

function affirmative(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === '' || t === '1' || t === 'y' || t === 'yes';
}

function negative(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === '2' || t === 'n' || t === 'no';
}

/**
 * Ensure `model` is downloaded to the HF cache. If it's missing, ask the user
 * for permission (Enter or `1` = yes, `2` / `n` / `no` / Escape = no), then
 * download with a progress display and rotating whimsical messages.
 *
 * Returns true if the model is ready to use, false if the user declined or
 * the download failed.
 */
export async function ensureModelDownloaded(ctx: CommandContext, model: string): Promise<boolean> {
  if (await isCachedComplete(model)) return true;

  ctx.log(`{yellow-fg}⚠ Model not cached locally:{/yellow-fg} {bold}${model}{/bold}`);
  ctx.log('{gray-fg}Asking HuggingFace how big this is…{/gray-fg}');

  let totalBytes = 0;
  try {
    totalBytes = await fetchModelSize(model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`{red-fg}Could not query HF: ${msg}{/red-fg}`);
    ctx.log('{gray-fg}You can still proceed — progress will show bytes downloaded only.{/gray-fg}');
  }

  const sizeLabel = totalBytes > 0 ? formatBytes(totalBytes) : 'unknown size';
  ctx.log(`Download size: {bold}${sizeLabel}{/bold}.`);
  const answer = await ctx.prompt(
    `Proceed with download? {bold}[1 / Enter = yes · 2 / Escape = no]{/bold}`,
  );

  if (answer === null || negative(answer)) {
    ctx.log('{gray-fg}Download cancelled — try again later or pick a smaller --model.{/gray-fg}');
    return false;
  }
  if (!affirmative(answer)) {
    ctx.log(`{gray-fg}Treating "${answer}" as no — download cancelled.{/gray-fg}`);
    return false;
  }

  const dir = modelCacheDir(model);
  const startBytes = await dirSizeBytes(dir);
  const start = Date.now();
  const handle = downloadModel(model, pickPython());

  let frame = 0;
  let whimsyIdx = Math.floor(Math.random() * WHIMSY.length);
  let lastWhimsyTick = Date.now();

  const poll = setInterval(async () => {
    let cur = 0;
    try {
      cur = await dirSizeBytes(dir);
    } catch {
      /* ignore */
    }
    if (Date.now() - lastWhimsyTick > 2500) {
      whimsyIdx = (whimsyIdx + 1) % WHIMSY.length;
      lastWhimsyTick = Date.now();
    }
    const spinner = SPINNER[frame % SPINNER.length] ?? '';
    frame++;

    const downloaded = Math.max(0, cur - startBytes);
    const elapsedS = Math.max(1, Math.round((Date.now() - start) / 1000));
    const rate = downloaded / elapsedS;
    const rateLabel = rate > 0 ? `${formatBytes(rate)}/s` : '— /s';

    let progressLine: string;
    if (totalBytes > 0) {
      const pct = Math.min(100, (cur / totalBytes) * 100).toFixed(1);
      progressLine =
        ` {cyan-fg}${spinner}{/cyan-fg} {bold}${WHIMSY[whimsyIdx]}…{/bold}  ` +
        `{yellow-fg}${formatBytes(cur)}{/yellow-fg} / ${formatBytes(totalBytes)} ` +
        `{bold}(${pct}%){/bold}  {gray-fg}${rateLabel} · ${elapsedS}s{/gray-fg}`;
    } else {
      progressLine =
        ` {cyan-fg}${spinner}{/cyan-fg} {bold}${WHIMSY[whimsyIdx]}…{/bold}  ` +
        `{yellow-fg}${formatBytes(cur)}{/yellow-fg} {gray-fg}${rateLabel} · ${elapsedS}s{/gray-fg}`;
    }
    ctx.progress(progressLine);
  }, 250);

  try {
    await handle.done;
    clearInterval(poll);
    ctx.progress(null);
    const finalBytes = await dirSizeBytes(dir);
    const totalElapsed = ((Date.now() - start) / 1000).toFixed(0);
    ctx.log(
      `{green-fg}✓ Downloaded ${formatBytes(finalBytes - startBytes)} in ${totalElapsed}s.{/green-fg}`,
    );
    return true;
  } catch (err) {
    clearInterval(poll);
    ctx.progress(null);
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`{red-fg}✗ Download failed: ${msg}{/red-fg}`);
    return false;
  }
}
