interface Args {
  player?: string;
  season?: number;
  wOBA?: number;
  xwOBA?: number;
  wRCplus?: number;
  barrelRatePct?: number;
  synthetic?: boolean;
}

/**
 * ASCII renderer for the player_card widget. The CLI wraps the returned text
 * in a panel; we just produce labeled rows. A future web renderer would
 * import the same module and export a React component side-by-side.
 */
export default {
  renderText(args: Args): string {
    const lines: string[] = [];
    lines.push(args.player ?? '(unnamed player)');
    if (args.season !== undefined) lines.push(`Season: ${args.season}`);
    lines.push('');
    if (args.wOBA !== undefined) lines.push(`  wOBA          ${fmt(args.wOBA, 3)}`);
    if (args.xwOBA !== undefined) lines.push(`  xwOBA         ${fmt(args.xwOBA, 3)}`);
    if (args.wRCplus !== undefined) lines.push(`  wRC+          ${fmt(args.wRCplus, 0)}`);
    if (args.barrelRatePct !== undefined) lines.push(`  Barrel/PA     ${fmt(args.barrelRatePct, 1)}%`);
    if (args.synthetic) {
      lines.push('');
      lines.push('  (synthetic data — illustrative, not authoritative)');
    }
    return lines.join('\n');
  },
};

function fmt(n: number, digits: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}
