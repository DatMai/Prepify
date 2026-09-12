import { spawn } from 'node:child_process';

const services = [
  { name: 'frontend', command: 'npm', args: ['run', 'dev:frontend'], cwd: process.cwd() },
  {
    name: 'backend',
    command: 'npm',
    args: ['run', 'dev'],
    cwd: new URL('../server/', import.meta.url),
  },
];

const children = services.map(({ name, command, args, cwd }) => {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[dev:${name}] failed to start:`, error.message);
  });
  return { name, child };
});

let stopping = false;

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (!child.killed) child.kill(signal);
  }
  const forceExit = setTimeout(() => process.exit(exitCode), 2_000);
  forceExit.unref();
  Promise.all(
    children.map(({ child }) => new Promise((resolve) => child.once('exit', resolve))),
  ).then(() => process.exit(exitCode));
}

for (const { name, child } of children) {
  child.on('exit', (code, signal) => {
    if (stopping) return;
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[dev:${name}] stopped${signal ? ` (${signal})` : ` with code ${exitCode}`}`);
    stop('SIGTERM', exitCode || 1);
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
