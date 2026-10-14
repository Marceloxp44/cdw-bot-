const { spawn } = require('child_process')
const fs = require('fs'), path = require('path')

const MODOS = {
esticar: 'scale=512:512,setsar=1,format=rgba',
cortar: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,format=rgba',
caber: 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000'
}

// Cor de fundo usada no vídeo (mp4 não tem transparência). [R, G, B]
const FUNDO = [0, 0, 0]
const MAX_FRAMES = 120
const MAX_TICKS = 250 // 250 ticks de 40ms = 10 segundos

function ffmpeg(args, entrada) {
return new Promise((ok, erro) => {
const ff = spawn('ffmpeg', ['-loglevel', 'error', ...args])
const out = [], err = []
ff.stdout.on('data', d => out.push(d))
ff.stderr.on('data', d => err.push(d))
ff.on('error', erro)
ff.on('close', cod => cod === 0 ? ok(Buffer.concat(out)) : erro(new Error('ffmpeg saiu com código ' + cod + ': ' + Buffer.concat(err).toString().trim().slice(-300))))
ff.stdin.on('error', () => {})
ff.stdin.end(entrada || undefined)
})
}

/**
 * Cria uma figurinha .webp a partir de imagem, vídeo ou gif.
 * animada=true para vídeo/gif. modo: 'esticar' | 'cortar' | 'caber'
 */
async function criarFigurinha(entrada, { animada = false, modo = 'esticar' } = {}) {
const vf = MODOS[modo] || MODOS.esticar
const saida = entrada + '.webp'
const limite = animada ? 500 * 1024 : 100 * 1024
const tentativas = animada ? [[15, 45], [12, 35], [10, 25], [8, 15]] : [[0, 75], [0, 55], [0, 35]]
try {
let resultado = null
for(const [fps, q] of tentativas) {
const args = animada
? ['-y', '-t', '6', '-i', entrada, '-vf', `fps=${fps},${vf}`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(q), '-compression_level', '6', '-loop', '0', '-an', saida]
: ['-y', '-i', entrada, '-vf', vf, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(q), '-an', '-frames:v', '1', saida]
await ffmpeg(args)
resultado = fs.readFileSync(saida)
if(resultado.length <= limite) break
}
return resultado
} finally {
try { fs.unlinkSync(saida) } catch {}
}
}

//=============[ WEBP ANIMADO -> MP4 ]=============\\

function lerWebpAnimado(buf) {
const naoAnimada = () => Object.assign(new Error('Figurinha não animada'), { code: 'NAO_ANIMADA' })
if(buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw naoAnimada()
let pos = 12, canvas = null
const frames = []
while(pos + 8 <= buf.length) {
const tipo = buf.toString('ascii', pos, pos + 4), tam = buf.readUInt32LE(pos + 4), ini = pos + 8
if(tipo === 'VP8X') canvas = { w: buf.readUIntLE(ini + 4, 3) + 1, h: buf.readUIntLE(ini + 7, 3) + 1 }
if(tipo === 'ANMF') {
frames.push({
x: buf.readUIntLE(ini, 3) * 2,
y: buf.readUIntLE(ini + 3, 3) * 2,
w: buf.readUIntLE(ini + 6, 3) + 1,
h: buf.readUIntLE(ini + 9, 3) + 1,
dur: buf.readUIntLE(ini + 12, 3),
flags: buf[ini + 15],
dados: buf.subarray(ini + 16, ini + tam)
})
}
pos = ini + tam + (tam % 2)
}
if(!canvas || frames.length < 2) throw naoAnimada()
return { canvas, frames }
}

function webpDoFrame(f) {
const vp8x = Buffer.alloc(18)
vp8x.write('VP8X', 0, 'ascii')
vp8x.writeUInt32LE(10, 4)
vp8x[8] = 0x10
vp8x.writeUIntLE(f.w - 1, 12, 3)
vp8x.writeUIntLE(f.h - 1, 15, 3)
const corpo = Buffer.concat([Buffer.from('WEBP', 'ascii'), vp8x, f.dados])
const cab = Buffer.alloc(8)
cab.write('RIFF', 0, 'ascii')
cab.writeUInt32LE(corpo.length, 4)
return Buffer.concat([cab, corpo])
}

async function decodificarFrame(f) {
const raw = await ffmpeg(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], webpDoFrame(f))
if(raw.length !== f.w * f.h * 4) throw new Error('Frame decodificado com tamanho inesperado')
return raw
}

function desenhar(canvas, W, f, px) {
const sobrescrever = (f.flags & 2) !== 0
for(let yy = 0; yy < f.h; yy++) {
for(let xx = 0; xx < f.w; xx++) {
const s = (yy * f.w + xx) * 4, d = ((f.y + yy) * W + (f.x + xx)) * 4
if(d + 3 >= canvas.length) continue
const as = px[s + 3]
if(sobrescrever || as === 255) {
canvas[d] = px[s]; canvas[d + 1] = px[s + 1]; canvas[d + 2] = px[s + 2]; canvas[d + 3] = as
} else if(as > 0) {
const ad = canvas[d + 3], a1 = as / 255, a2 = (ad / 255) * (1 - a1), ao = a1 + a2
canvas[d] = (px[s] * a1 + canvas[d] * a2) / ao
canvas[d + 1] = (px[s + 1] * a1 + canvas[d + 1] * a2) / ao
canvas[d + 2] = (px[s + 2] * a1 + canvas[d + 2] * a2) / ao
canvas[d + 3] = ao * 255
}
}
}
}

function limpar(canvas, W, f) {
for(let yy = 0; yy < f.h; yy++) {
const ini = ((f.y + yy) * W + f.x) * 4
canvas.fill(0, ini, ini + f.w * 4)
}
}

function achatar(canvas) {
const out = Buffer.alloc((canvas.length / 4) * 3)
for(let i = 0, j = 0; i < canvas.length; i += 4, j += 3) {
const a = canvas[i + 3] / 255
out[j] = canvas[i] * a + FUNDO[0] * (1 - a)
out[j + 1] = canvas[i + 1] * a + FUNDO[1] * (1 - a)
out[j + 2] = canvas[i + 2] * a + FUNDO[2] * (1 - a)
}
return out
}

function escrever(stdin, buf) {
return new Promise(res => { if(stdin.write(buf)) res(); else stdin.once('drain', res) })
}

async function codificar(frames, W, H, codec, saida) {
const args = ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '25', '-i', 'pipe:0',
'-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', ...codec, '-movflags', '+faststart', '-an', saida]
const ff = spawn('ffmpeg', ['-loglevel', 'error', ...args])
const err = []
ff.stderr.on('data', d => err.push(d))
const fim = new Promise((ok, erro) => {
ff.on('error', erro)
ff.on('close', cod => cod === 0 ? ok() : erro(new Error('ffmpeg saiu com código ' + cod + ': ' + Buffer.concat(err).toString().trim().slice(-300))))
})
ff.stdin.on('error', () => {})
for(const fr of frames) for(let r = 0; r < fr.rep; r++) await escrever(ff.stdin, fr.rgb)
ff.stdin.end()
await fim
}

/**
 * Converte uma figurinha animada (webp) em vídeo mp4 (para enviar como gif).
 * Lança erro com code 'NAO_ANIMADA' se a figurinha não for animada.
 */
async function webpAnimadoParaMp4(buffer) {
const { canvas: tela, frames } = lerWebpAnimado(buffer)
const W = tela.w, H = tela.h
if(W > 2048 || H > 2048) throw new Error('Figurinha grande demais')

const canvas = Buffer.alloc(W * H * 4)
const prontos = []
let ticks = 0, anterior = null

for(const f of frames.slice(0, MAX_FRAMES)) {
if(anterior && (anterior.flags & 1)) limpar(canvas, W, anterior)
desenhar(canvas, W, f, await decodificarFrame(f))
const rep = Math.max(1, Math.round(f.dur / 40))
prontos.push({ rgb: achatar(canvas), rep })
anterior = f
ticks += rep
if(ticks >= MAX_TICKS) break
}

const pasta = path.join(__dirname, '..', 'media')
fs.mkdirSync(pasta, { recursive: true })
const saida = path.join(pasta, `.togif-${Date.now()}-${Math.floor(Math.random() * 1e5)}.mp4`)
try {
try {
await codificar(prontos, W, H, ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'], saida)
} catch(e) {
await codificar(prontos, W, H, ['-c:v', 'mpeg4', '-q:v', '4'], saida)
}
return fs.readFileSync(saida)
} finally {
try { fs.unlinkSync(saida) } catch {}
}
}

//=============[ NOME DO PACOTE / AUTOR (EXIF) ]=============\\

function chunkWebp(tipo, dados) {
const cab = Buffer.alloc(8)
cab.write(tipo, 0, 'ascii')
cab.writeUInt32LE(dados.length, 4)
return Buffer.concat([cab, dados, dados.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

/**
 * Grava nome do pacote e autor na figurinha (webp estático ou animado).
 * É o que o WhatsApp mostra ao abrir a figurinha. Retorna um novo Buffer.
 */
function adicionarExif(webp, pack = '', autor = '') {
if(webp.length < 20 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Arquivo não é uma figurinha webp')

const json = Buffer.from(JSON.stringify({
'sticker-pack-id': require('crypto').randomBytes(16).toString('hex'),
'sticker-pack-name': String(pack).slice(0, 80),
'sticker-pack-publisher': String(autor).slice(0, 80),
emojis: ['🤖']
}), 'utf8')
const exif = Buffer.concat([Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]), json])
exif.writeUInt32LE(json.length, 14)

const chunks = []
let pos = 12
while(pos + 8 <= webp.length) {
const tipo = webp.toString('ascii', pos, pos + 4), tam = webp.readUInt32LE(pos + 4)
chunks.push({ tipo, dados: webp.subarray(pos + 8, pos + 8 + tam) })
pos += 8 + tam + (tam % 2)
}

const resto = chunks.filter(c => c.tipo !== 'VP8X' && c.tipo !== 'EXIF')
const antigo = chunks.find(c => c.tipo === 'VP8X')
let vp8x
if(antigo) {
vp8x = Buffer.from(antigo.dados)
vp8x[0] |= 0x08
} else {
const img = resto.find(c => c.tipo === 'VP8 ' || c.tipo === 'VP8L')
if(!img) throw new Error('Figurinha webp inválida')
let w, h, alfa = false
if(img.tipo === 'VP8L') {
const b = img.dados.readUInt32LE(1)
w = (b & 0x3fff) + 1; h = ((b >>> 14) & 0x3fff) + 1; alfa = ((b >>> 28) & 1) === 1
} else {
w = img.dados.readUInt16LE(6) & 0x3fff; h = img.dados.readUInt16LE(8) & 0x3fff
}
vp8x = Buffer.alloc(10)
vp8x[0] = 0x08 | (alfa ? 0x10 : 0)
vp8x.writeUIntLE(w - 1, 4, 3)
vp8x.writeUIntLE(h - 1, 7, 3)
}

const corpo = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunkWebp('VP8X', vp8x), ...resto.map(c => chunkWebp(c.tipo, c.dados)), chunkWebp('EXIF', exif)])
const cab = Buffer.alloc(8)
cab.write('RIFF', 0, 'ascii')
cab.writeUInt32LE(corpo.length, 4)
return Buffer.concat([cab, corpo])
}

module.exports = { criarFigurinha, webpAnimadoParaMp4, adicionarExif }
