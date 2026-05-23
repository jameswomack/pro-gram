#!/usr/bin/env node
import 'dotenv/config';
import { createTui } from '@jameswomack/clitermus';
import { mlExec, mlChat, shutdownMlClients } from './commands/ml.js';
import { healthApi, healthWeb, healthAll } from './commands/health.js';
import { specStatus } from './commands/spec.js';
import { packList, packInfo, packRun, shutdownPackClients } from './commands/pack.js';

const tui = createTui({
  title: 'pro-gram CLI',
  welcome:
    'Welcome to the pro-gram CLI.\n' +
    'Type {bold}/help{/bold} for commands. Grammar: {bold}/<domain> <action> [args]{/bold}.\n' +
    'Examples: {cyan-fg}/pack list{/cyan-fg} · {cyan-fg}/pack run baseball-stats{/cyan-fg} · {cyan-fg}/ml chat{/cyan-fg}',
  statusItems: [
    { id: 'model', cols: 6, content: '{gray-fg}model: (lazy){/gray-fg}' },
    { id: 'api', cols: 3, content: 'API: ?' },
    { id: 'web', cols: 3, content: 'Web: ?' },
  ],
  commands: [
    { name: 'pack list', description: 'List available agent packs.', handler: packList },
    { name: 'pack info', description: 'Show a pack\'s manifest, tools, skills, and composed system prompt. Usage: /pack info <name>', handler: packInfo },
    { name: 'pack run', description: 'Enter an interactive chat with the given pack loaded. Usage: /pack run <name>', handler: packRun },
    { name: 'ml exec', description: 'Run a one-shot prompt via mluxe (CLI mode). Usage: /ml exec "your prompt"', handler: mlExec },
    { name: 'ml chat', description: 'Enter an interactive multi-turn chat. Escape or /exit to leave. Usage: /ml chat [opening prompt]', handler: mlChat },
    { name: 'health api', description: 'Check the Fastify API health endpoint.', handler: healthApi },
    { name: 'health web', description: 'Check the Next.js web app.', handler: healthWeb },
    { name: 'health all', description: 'Check all apps in sequence.', handler: healthAll },
    { name: 'spec status', description: 'Show feature registry status from .ai/SPEC.md.', handler: specStatus },
  ],
});

// Best-effort cleanup of cached children when this process exits.
process.on('exit', () => { shutdownMlClients(); shutdownPackClients(); });
process.on('SIGINT', () => { shutdownMlClients(); shutdownPackClients(); });
process.on('SIGTERM', () => { shutdownMlClients(); shutdownPackClients(); });

tui.start();
