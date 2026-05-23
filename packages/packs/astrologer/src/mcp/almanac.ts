import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Minimal "almanac" tool — returns the current celestial-ish time. A real
 * implementation would compute moon phase, planet positions via an ephemeris.
 * Phase 1 returns coarse signals to demonstrate the tool loop.
 */
const server = new Server(
  { name: 'astrologer-almanac', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const MOON_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

const PLANET_DAYS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'current_celestial_time',
      description:
        'Get the current date/time plus coarse celestial context: which planet rules today, ' +
        'and a (synthetic, slowly-cycling) moon sign. PHASE 1: not based on a real ephemeris.',
      inputSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA tz, e.g. "America/Los_Angeles". Defaults to the host timezone.',
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'current_celestial_time') {
    return { isError: true, content: [{ type: 'text', text: `unknown tool ${req.params.name}` }] };
  }
  const args = (req.params.arguments ?? {}) as { timezone?: string };
  const tz = args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  // Cycle moon sign every ~2.4 days, planet day by classical weekday.
  const moonSign = MOON_SIGNS[Math.floor(now.getTime() / (1000 * 60 * 60 * 60)) % MOON_SIGNS.length];
  const weekday = now.getDay(); // 0 = Sun
  const planetDay = PLANET_DAYS[weekday];

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            synthetic: true,
            isoTime: now.toISOString(),
            localized: new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: tz }).format(now),
            weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday],
            planetDay,
            moonSign,
            note: 'Coarse / not from an ephemeris. Treat as flavoring, not divination.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

export default server;
