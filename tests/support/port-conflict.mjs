import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const occupied = createServer((_req, response) => { response.setHeader('content-type', 'application/json'); response.end('{"appId":"different-app"}'); });
await new Promise((done, reject) => occupied.once('error', reject).listen(4317, '127.0.0.1', done));
try {
  const child = spawn(process.execPath, [resolve('dist/server/server/index.js'), '--no-open'], { cwd: 'C:\\Users\\Kano', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const timeout = setTimeout(() => child.kill(), 8000);
  const exitCode = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', code => done(code)); }); clearTimeout(timeout);
  const falseStartup = output.includes('番时记已启动');
  console.log(JSON.stringify({ exitCode, explicitConflict: output.includes('4317已被其他程序占用'), falseStartup, output: output.trim() }));
  if (exitCode !== 1 || !output.includes('4317已被其他程序占用') || falseStartup) process.exitCode = 1;
} finally { await new Promise(done => occupied.close(done)); }
