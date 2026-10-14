//==============================================================\\


//=============[ COMEÇO DE TUDO ]=============\\

// A Zapo modificada fica inteira na pasta ./zapo da própria base.
// Ela não depende mais de cópia em dados/zapo nem de patch em node_modules.

const { fs, path, chalk, WaClient, createStore, sessao, logger, banner1, banner2 } = require('./dados/lib/index.js')
const { NomeDoBot } = require('./dados/config.json')
const readline = require('readline')

//=============[ SESSÃO ]=============\\

const store = createStore({
backends: {
arquivo: sessao(path.join(__dirname, 'database', 'sessao'))
},
providers: {
auth: 'arquivo',
signal: 'arquivo',
preKey: 'arquivo',
session: 'arquivo',
identity: 'arquivo',
senderKey: 'arquivo',
appState: 'arquivo',
privacyToken: 'arquivo',
messages: 'none',
threads: 'none',
contacts: 'none'
}
})

//=============[ CONEXÃO ]=============\\

const diablo = new WaClient({
store,
sessionId: 'diablo',
connectTimeoutMs: 15000,
nodeQueryTimeoutMs: 30000,
history: { enabled: false },
recoverFromClientTooOld: true
}, logger)

// Confirma que a Zapo local carregada pela base contém os recursos modificados.
// Se isto falhar, o bot para aqui em vez de esconder o problema usando menu normal.
if (
  typeof diablo.message?.sendCarousel !== 'function' ||
  typeof diablo.message?.sendInteractive !== 'function'
) {
  throw new Error(
    '[DIABLO] Zapo local não possui os recursos esperados. ' +
    'sendCarousel/sendInteractive não estão disponíveis.'
  )
}

let pareando = false
let pedido = false
let pareado = false
let encerrando = false
let ultimoCodigo = ''
let tentativa = 0
let reconectando = false

function perguntar(texto) {
return new Promise(resolve => {
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question(texto, resposta => {
rl.close()
resolve(resposta)
})
})
}

async function numero() {
while(true) {
const resposta = await perguntar(chalk.blue('Digite o número do WhatsApp com DDI: ') + chalk.white(''))
const n = String(resposta || '').replace(/\D/g, '')
if(n.length >= 10) return n
console.log(chalk.blue('[ NÚMERO ] ') + chalk.white('Digite um número válido com DDI. Exemplo: 5599999999999'))
}
}

function carregar() {
return require('./diablo.js')
}

async function reconectar() {
if(reconectando) return
reconectando = true
const tempo = Math.min(30000, 1000 * 2 ** tentativa)
tentativa++

setTimeout(async() => {
reconectando = false
try {
await diablo.connect()
} catch(e) {
console.log(chalk.blue('[ CONEXÃO ] ') + chalk.white(e?.message || e))
reconectar()
}
}, tempo)
}

//=============[ PAREAMENTO ]=============\\

function codigo(code) {
const raw = String(code || '').replace(/[-\s]/g, '')
if(!raw || raw === ultimoCodigo) return
ultimoCodigo = raw
const formatado = raw.match(/.{1,4}/g)?.join('-') || raw
console.log(chalk.blue('Código de pareamento: ') + chalk.white.bold(formatado))
console.log(chalk.white('No WhatsApp: Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone.'))
}

async function parear() {
if(pareando || pedido || pareado || encerrando) return
pareando = true
pedido = true

try {
const n = await numero()
const code = await diablo.auth.requestPairingCode(n)
codigo(code)
} catch(e) {
pedido = false
console.log(chalk.blue('[ ERRO ] ') + chalk.white(e?.message || e))
} finally {
pareando = false
}
}

// Evento oficial para fluxo por código.
diablo.on('auth_pairing_required', async() => {
await parear()
})

// Fallback: algumas sessões novas chegam primeiro no QR.
// O QR só é usado como sinal de que a conexão já está pronta para pedir o código.
diablo.on('auth_qr', async() => {
await parear()
})

// A biblioteca também emite o código; usamos apenas como fallback de exibição.
diablo.on('auth_pairing_code', ({ code } = {}) => {
codigo(code)
})

diablo.on('auth_paired', () => {
pareado = true
pedido = true
})

//=============[ CONNECTION ]=============\\

diablo.on('connection', event => {
const connection = event.status

switch(connection) {

case 'connecting':
break

case 'open':
pareado = true
tentativa = 0
reconectando = false
console.log('\n' + banner1)
console.log(banner2)
console.log(chalk.blue('�? ') + chalk.white(`${NomeDoBot} conectado com sucesso!`))
break

case 'close':
case 'closed':
if(encerrando) break
if(event.isLogout) {
console.log(chalk.blue('[ CONEXÃO ] ') + chalk.white('A conta foi desvinculada. Reinicie para fazer um novo pareamento.'))
break
}
console.log(chalk.blue('[ CONEXÃO ] ') + chalk.white(`Conexão encerrada${event.reason ? `: ${event.reason}` : '.'}`))
reconectar()
break

}
})

//=============[ EVENTOS DO GRUPO ]=============\\

diablo.on('group', async event => {
try {
const startdiablo = carregar()
await startdiablo(diablo, event, 'group')
} catch(e) {
console.log(chalk.blue('[ GRUPO ] ') + chalk.white(e?.message || e))
}
})

//=============[ MENSAGENS ]=============\\

diablo.on('message', async info => {
if(!info?.message) return

try {
const startdiablo = carregar()
await startdiablo(diablo, info, 'message')
} catch(e) {
console.log(chalk.blue('[ ERRO ] ') + chalk.white(e?.message || e))
}
})

//=============[ ATUALIZAÇÕES ]=============\\

const arquivos = [
path.join(__dirname, 'diablo.js'),
path.join(__dirname, 'dados', 'lib', 'index.js'),
path.join(__dirname, 'dados', 'lib', 'main.js'),
path.join(__dirname, 'dados', 'lib', 'menus.js'),
path.join(__dirname, 'dados', 'lib', 'global.js')
]

for(const file of arquivos) {
if(!fs.existsSync(file)) continue

fs.watchFile(file, { interval: 1000 }, () => {
const nome = path.relative(__dirname, file)
console.log(chalk.blue(`Alterações salvas, carregando novamente: '${nome}'`))

try { delete require.cache[require.resolve(file)] } catch {}
try { delete require.cache[require.resolve('./dados/lib/index.js')] } catch {}
try { delete require.cache[require.resolve('./diablo.js')] } catch {}
})
}

//=============[ INÍCIO ]=============\\

diablo.connect().catch(e => {
console.log(chalk.blue('[ ERRO ] ') + chalk.white(e?.message || e))
reconectar()
})

async function fechar() {
if(encerrando) return
encerrando = true
try { await diablo.disconnect() } catch {}
try { await store.destroy() } catch {}
process.exit(0)
}

process.on('SIGINT', fechar)
process.on('SIGTERM', fechar)
