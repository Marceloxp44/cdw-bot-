const { spawnSync, spawn } = require('child_process');
const path = require('path');

function git(args) {
  const r = spawnSync('git', args, {
    cwd: __dirname,
    stdio: 'inherit'
  });

  if (r.error || r.status !== 0) {
    console.error('Falha no Git. Atualização interrompida.');
    process.exit(1);
  }
}

if (process.argv[2] === 'up') {
  console.log('Buscando atualizações...');
  git(['fetch', 'origin', 'main']);
  git(['merge', '--ff-only', 'origin/main']);
  console.log('Atualização concluída!');
}

console.log('Iniciando NERO BOT...');
const bot = spawn(process.execPath, ['connect.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

bot.on('error', e => {
  console.error('Erro ao iniciar:', e.message);
  process.exitCode = 1;
});

bot.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
