'use strict';

const { createApp } = require('./app');

async function main() {
  const chat = createApp();
  const address = await chat.start();
  const host = ['0.0.0.0', '::'].includes(address.address) ? 'localhost' : address.address;
  const base = `http://${host}:${address.port}`;
  console.log(`Feeof 客服系统已启动: ${base}`);
  console.log(`  客服工作台: ${base}/agent/`);
  console.log(`  访客演示页: ${base}/`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await chat.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
