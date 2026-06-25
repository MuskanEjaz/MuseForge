const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const shell = isWindows;

const backend = spawn(npmCommand, ['--prefix', 'backend', 'start'], {
  stdio: 'inherit',
  shell,
});

const frontend = spawn(npmCommand, ['start'], {
  stdio: 'inherit',
  shell,
});

const shutdown = () => {
  if (!backend.killed) backend.kill();
  if (!frontend.killed) frontend.kill();
};

backend.on('exit', code => {
  if (code && code !== 0) console.error(`Backend exited with code ${code}`);
});
frontend.on('exit', code => {
  if (code && code !== 0) console.error(`Frontend exited with code ${code}`);
});
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
