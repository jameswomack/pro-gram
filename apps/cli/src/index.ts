#!/usr/bin/env node
import 'dotenv/config';
import { createTui } from '@jameswomack/clitermus';
import { mlExec, mlChat, shutdownMlClients } from './commands/ml.js';
import { healthApi, healthWeb, healthAll } from './commands/health.js';
import { specStatus } from './commands/spec.js';

const tui = createTui({
  title: 'pro-gram CLI',
  welcome:
    'Welcome to the pro-gram CLI.\n' +
    'Type {bold}/help{/bold} for commands. Grammar: {bold}/<domain> <action> [args]{/bold}.\n' +
    'Examples: {cyan-fg}/ml exec "Hello"{/cyan-fg} · {cyan-fg}/health all{/cyan-fg} · {cyan-fg}/spec status{/cyan-fg}',
  statusItems: [
    { id: 'model', cols: 6, content: '{gray-fg}model: (lazy){/gray-fg}' },
    { id: 'api', cols: 3, content: 'API: ?' },
    { id: 'web', cols: 3, content: 'Web: ?' },
  ],
  commands: [
    { name: 'ml exec', description: 'Run a one-shot prompt via mluxe (CLI mode). Usage: /ml exec "your prompt"', handler: mlExec },
    { name: 'ml chat', description: 'Enter an interactive multi-turn chat. Escape or /exit to leave. Usage: /ml chat [opening prompt]', handler: mlChat },
    { name: 'health api', description: 'Check the Fastify API health endpoint.', handler: healthApi },
    { name: 'health web', description: 'Check the Next.js web app.', handler: healthWeb },
    { name: 'health all', description: 'Check all apps in sequence.', handler: healthAll },
    { name: 'spec status', description: 'Show feature registry status from .ai/SPEC.md.', handler: specStatus },
  ],
});

// Best-effort cleanup of cached mlx_lm.server children when this process exits.
// SIGINT/SIGTERM are already handled by clitermus → process.exit(0), which fires 'exit'.
process.on('exit', shutdownMlClients);
process.on('SIGINT', shutdownMlClients);
process.on('SIGTERM', shutdownMlClients);

tui.start();
