import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

const start = async () => {
  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`@jameswomack/api listening on :${port}`);
};

start();
