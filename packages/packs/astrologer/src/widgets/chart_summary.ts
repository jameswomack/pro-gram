interface Args {
  subject?: string;
  sun?: string;
  moon?: string;
  rising?: string;
  planetDay?: string;
  currentMoon?: string;
  headlineTransit?: string;
  synthetic?: boolean;
}

export default {
  renderText(args: Args): string {
    const lines: string[] = [];
    lines.push(args.subject ?? 'Celestial snapshot');
    lines.push('');
    if (args.sun)    lines.push(`  ☉ Sun         ${args.sun}`);
    if (args.moon)   lines.push(`  ☽ Moon        ${args.moon}`);
    if (args.rising) lines.push(`  ↑ Rising      ${args.rising}`);
    if (args.planetDay)   lines.push(`  Day ruler     ${args.planetDay}`);
    if (args.currentMoon) lines.push(`  Moon now      ${args.currentMoon}`);
    if (args.headlineTransit) {
      lines.push('');
      lines.push(`  ✦ ${args.headlineTransit}`);
    }
    if (args.synthetic) {
      lines.push('');
      lines.push('  (illustrative — not from a real ephemeris)');
    }
    return lines.join('\n');
  },
};
