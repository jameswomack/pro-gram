import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Synthetic baseball stats lookup. Demonstrates the pack's tool wiring without
 * needing an external API in Phase 1. Returns plausible-shaped numbers and
 * always flags itself as synthetic so the model tells the user.
 *
 * A real version would hit Statcast / Baseball Savant / FanGraphs.
 */
const server = new Server(
  { name: 'baseball-stats', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'lookup_player',
      description:
        'Look up a player by name and return a snapshot of advanced metrics. ' +
        'PHASE 1 NOTE: this returns synthetic data — disclose that to the user when citing it.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name, e.g. "Bobby Witt Jr."' },
          season: { type: 'integer', description: 'Season year (defaults to most recent).' },
        },
        required: ['name'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'lookup_player') {
    return { isError: true, content: [{ type: 'text', text: `unknown tool ${req.params.name}` }] };
  }
  const args = (req.params.arguments ?? {}) as { name?: string; season?: number };
  const name = args.name ?? '(unknown)';
  const season = args.season ?? 2025;
  // Deterministic-ish synthetic numbers seeded on the name so demos feel consistent.
  const seed = [...name].reduce((s, c) => (s + c.charCodeAt(0)) % 1000, 0);
  const wOBA = (0.300 + (seed % 80) / 1000).toFixed(3);
  const xwOBA = (0.300 + ((seed * 7) % 80) / 1000).toFixed(3);
  const wRCplus = 80 + (seed % 80);
  const barrelRate = (5 + (seed % 100) / 10).toFixed(1);
  const triples = 3;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            synthetic: true,
            player: name,
            season,
            triples,
            wOBA,
            xwOBA,
            wRCplus,
            barrelRatePct: barrelRate,
            note: 'Phase 1 placeholder data — do not cite as authoritative.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

export default server;
