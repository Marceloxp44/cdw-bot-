const { execFile } = require('child_process')
const fs = require('fs'), path = require('path')

// Usa ./yt-dlp na pasta raiz do bot, se existir; senão o yt-dlp global
const BIN = (() => {
const local = path.join(__dirname, '..', '..', 'yt-dlp')
return fs.existsSync(local) ? local : 'yt-dlp'
})()

const IGNORAR = ['.part', '.ytdl', '.json', '.description', '.jpg', '.jpeg', '.png', '.webp', '.temp']

const MIMES = {
m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/mp4',
mp3: 'audio/mpeg',
webm: 'audio/webm',
opus: 'audio/ogg; codecs=opus', ogg: 'audio/ogg; codecs=opus'
}

function rodar(args, timeout) {
return new Promise((ok, erro) => {
execFile(BIN, args, { maxBuffer: 1024 * 1024 * 30, timeout }, (err, stdout, stderr) => {
if(err) {
const detalhe = String(stderr || err.message || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 600)
const e = new Error(detalhe || 'Falha ao executar o yt-dlp'); e.code = err.code; return erro(e)
}
ok(stdout || '')
})
})
}

function achar(template) {
const pasta = path.dirname(template), prefixo = path.basename(template)
let lista = []
try { lista = fs.readdirSync(pasta) } catch { return null }
const nome = lista.find(n => n.startsWith(prefixo) && !IGNORAR.some(e => n.toLowerCase().endsWith(e)))
return nome ? path.join(pasta, nome) : null
}

function limpar(template) {
const pasta = path.dirname(template), prefixo = path.basename(template)
let lista = []
try { lista = fs.readdirSync(pasta) } catch { return }
for(const n of lista) if(n.startsWith(prefixo)) { try { fs.unlinkSync(path.join(pasta, n)) } catch {} }
}

function lerInfo(saida) {
let j = {}
for(const linha of String(saida).split('\n')) {
if(linha.trim().startsWith('{')) { try { j = JSON.parse(linha) } catch {} }
}
const yt = /youtube/i.test(String(j.extractor || '')) && j.id
const desc = String(j.description || '').replace(/\s+/g, ' ').trim()
return {
titulo: j.title || 'Não encontrado',
canal: j.channel || j.uploader || 'Não encontrado',
desc: desc ? (desc.length > 200 ? desc.slice(0, 200) + '...' : desc) : 'Não encontrado',
duracao: Number(j.duration) || 0,
thumb: yt ? `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg` : (j.thumbnail || '')
}
}

/**
 * Baixa só o áudio de uma URL ou de uma busca (texto) do YouTube.
 * Retorna { buffer, ext, mimetype, info }. Lança erro se tudo falhar.
 */
async function baixarAudioYtdlp(consulta, pasta) {
fs.mkdirSync(pasta, { recursive: true })
const alvo = /^https?:\/\//i.test(String(consulta)) ? String(consulta) : `ytsearch1:${String(consulta)}`
const template = path.join(pasta, `.yt-${Date.now()}-${Math.floor(Math.random() * 1e5)}`)

const base = [
alvo, '--no-playlist', '--no-warnings',
'--extractor-args', 'youtube:player_client=web,android,ios',
'--socket-timeout', '14', '--retries', '2', '--fragment-retries', '2',
'--concurrent-fragments', '8',
'--match-filter', 'duration<=?3600',
'--print-json',
'-o', `${template}.%(ext)s`
]

// Tentativas: m4a (mais compatível com WhatsApp) -> melhor áudio -> pior qualidade extraindo o áudio
const tentativas = [
['-f', 'bestaudio[ext=m4a]/bestaudio/best'],
['-f', 'bestaudio[ext=m4a]/bestaudio/best'],
['-f', 'bestaudio/worst', '--extract-audio']
]

let ultimoErro = null
try {
for(let i = 0; i < tentativas.length; i++) {
try {
const saida = await rodar([...tentativas[i], ...base], 120000)
if(/does not pass filter/i.test(saida)) { const el = new Error('Vídeo com mais de 1 hora'); el.code = 'LONGO'; throw el }
const arq = achar(template)
if(!arq) throw new Error('Download concluído, mas o arquivo não foi encontrado')
const buffer = fs.readFileSync(arq)
if(buffer.length < 5000) throw new Error('Arquivo baixado muito pequeno')
const ext = path.extname(arq).slice(1).toLowerCase()
return { buffer, ext, mimetype: MIMES[ext] || 'audio/mp4', info: lerInfo(saida) }
} catch(e) {
ultimoErro = e
console.log(`[YTDLP] tentativa ${i + 1} falhou:`, e.message)
limpar(template)
if(e.code === 'ENOENT' || e.code === 'LONGO') break
await new Promise(r => setTimeout(r, 1500))
}
}
throw ultimoErro || new Error('yt-dlp falhou')
} finally {
limpar(template)
}
}

module.exports = { baixarAudioYtdlp }
