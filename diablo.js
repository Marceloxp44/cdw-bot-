//==============================================================\\

//==============================================================\\


//=============[ COMEÇO DE TUDO ]=============\\

const { fs, os, path, spawn, axios, chalk, linguagem, mess, midia, numero, achar, alvo, baixar } = require('./dados/lib/index.js')
let { NomeDoBot, prefix, ownerName, ownerNumber } = require('./dados/config.json')
const { API_URL, API_KEY_DIABLO, API_KEY_BRONXYS } = require('./dados/api.json')
const { baixarAudioYtdlp } = require('./dados/lib/ytdlp.js')
const { criarFigurinha, webpAnimadoParaMp4, adicionarExif } = require('./dados/lib/figurinha.js')
const { guardarDono, ehDonoDoGrupo, analisarAdmin } = require('./dados/lib/donogp.js')

//=============[ ANTIFLOOD ]=============\\

const FLOOD = new Map() // grupo -> { user, count, last, msgs }
const FLOOD_LIMITE = 8 // mais que isso em sequência = banido
const FLOOD_INTERVALO = 30000 // ms: se passar disso entre uma mensagem e outra, a sequência zera

//=============[ ANTIFAKE ]=============\\

// Pega o número de telefone real (ignora @lid) e diz se NÃO é brasileiro (+55).
// Se não achar o número de telefone, retorna false (não bane quem não dá para identificar).
const telefoneReal = (...candidatos) => {
for(const c of candidatos.flat()) {
for(const v of [c, c?.jid, c?.phoneJid, c?.pnJid, c?.phoneNumber, c?.id]) {
const t = String(v || '')
if(/@s\.whatsapp\.net$/.test(t)) return t.split('@')[0].split(':')[0].replace(/\D/g, '')
if(/^\+?\d{8,15}$/.test(t)) return t.replace(/\D/g, '')
}
}
return ''
}
// Lê o estado do antifake direto do arquivo na hora de agir (nunca usa cópia antiga da memória).
const antifakeAtivo = grupoJid => {
try {
const arq = path.join(__dirname, 'dados', 'grupos', `${String(grupoJid).replace(/[\\/]/g, '_')}.json`)
return JSON.parse(fs.readFileSync(arq, 'utf8'))?.[0]?.antifake === true
} catch { return false }
}
const ehEstrangeiro = (...candidatos) => {
const tel = telefoneReal(...candidatos)
return !!tel && !tel.startsWith('55')
}

// ---- Lista negra (autoban) ----
// Números do Brasil podem existir com ou sem o 9 depois do DDD: compara as duas formas.
const variantesNumero = n => {
const d = String(n || '').replace(/\D/g, '')
const v = new Set(d ? [d] : [])
if(/^55\d{2}9\d{8}$/.test(d)) v.add(d.slice(0, 4) + d.slice(5))
else if(/^55\d{2}\d{8}$/.test(d)) v.add(d.slice(0, 4) + '9' + d.slice(4))
return [...v]
}
const naListaNegra = (lista, ...numeros) => {
if(!Array.isArray(lista) || !lista.length) return false
const alvos = new Set(numeros.flat().filter(Boolean).flatMap(variantesNumero))
return lista.some(n => variantesNumero(n).some(x => alvos.has(x)))
}
// Lê a lista direto do arquivo na hora de agir (mesma ideia do antifake).
const listaNegraDoGrupo = grupoJid => {
try {
const arq = path.join(__dirname, 'dados', 'grupos', `${String(grupoJid).replace(/[\\/]/g, '_')}.json`)
return JSON.parse(fs.readFileSync(arq, 'utf8'))?.[0]?.listanegra || []
} catch { return [] }
}

//=============[ ANTI-PALAVRÃO ]=============\\

// Edite à vontade. Escreva sem acento e em minúsculas.
// COMECAM_COM: pega a palavra e variações (ex.: "merd" pega merda, merdinha)
// EXATAS: só pega a palavra inteira (ex.: "cu" não pega "culpa")
const PALAVRAO_COMECAM_COM = ['porra', 'caralh', 'carai', 'merd', 'bosta', 'buceta', 'boceta', 'xoxota', 'puta', 'puto', 'foda', 'fode', 'fodi', 'cacete', 'arrombad', 'babaca', 'vagabund', 'cuzao', 'otario', 'otaria']
const PALAVRAO_EXATAS = ['cu', 'fdp', 'pqp', 'vsf', 'vtnc', 'krl', 'crl', 'tnc']
const colapsar = t => String(t || '').replace(/(.)\1+/g, '$1') // "caralhooo" -> "caralho"
const REGEX_PALAVRAO = new RegExp(`\\b(?:${PALAVRAO_COMECAM_COM.map(colapsar).join('|')})\\w*|\\b(?:${PALAVRAO_EXATAS.map(colapsar).join('|')})\\b`)
const temPalavrao = texto => REGEX_PALAVRAO.test(colapsar(texto))
// Palavras que cada grupo adiciona com /add_palavra (palavra ou frase inteira, sem acento e sem diferenciar maiúsculas)
const temPalavraoCustom = (texto, lista) => {
if(!Array.isArray(lista) || !lista.length) return false
const t = ` ${colapsar(normGatilho(texto))} `
return lista.some(p => p && t.includes(` ${colapsar(p)} `))
}

//=============[ AUTO-RESPOSTA ]=============\\

const AUTORESP_CD = new Map() // `${grupo}|${gatilho}` -> última vez que respondeu
const AUTORESP_INTERVALO = 30000 // ms: não repete a mesma resposta no grupo dentro desse tempo
const normGatilho = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

// Respostas que já vêm prontas (quem cadastrar o mesmo gatilho com /addresposta sobrescreve)
const AUTORESP_PADRAO = {
'bom dia': 'Bom dia! 🌞',
'boa tarde': 'Boa tarde! ☀️',
'boa noite': 'Boa noite! 🌙',
'tudo bem': 'Tudo ótimo! E você? ❤️',
'kkkkk': 'KKKKK 😂',
'oi': 'Oii! Seja bem-vindo! 👋',
'tchau': 'Até mais! ❤️',
'obrigado': 'Por nada! 🥰',
'te amo': 'Também gosto de você! ❤️',
'quem e voce': 'Sou o assistente do grupo! 🤖'
}

//=============[ OPENGP (ABERTURA AUTOMÁTICA) ]=============\\

let DIABLO_OPENGP = null
let OPENGP_TIMER = null
let OPENGP_RODANDO = false
const OPENGP_MAX_HORAS = 168 // limite do tempo da contagem (7 dias)
const OPENGP_EXTS = [['mp4', 'video/mp4'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg']]
const baseMediaOpenGp = jid => path.join(__dirname, 'dados', 'media', `opengp_${String(jid).replace(/[^a-zA-Z0-9]/g, '_')}`)

const acharMediaOpenGp = jid => {
for(const [ext, mimetype] of OPENGP_EXTS) {
const arquivo = `${baseMediaOpenGp(jid)}.${ext}`
if(fs.existsSync(arquivo)) return { arquivo, mimetype, tipo: ext === 'mp4' ? 'video' : 'image' }
}
return null
}

const removerMediaOpenGp = jid => {
let removeu = false
for(const [ext] of OPENGP_EXTS) {
const arquivo = `${baseMediaOpenGp(jid)}.${ext}`
if(fs.existsSync(arquivo)) { fs.unlinkSync(arquivo); removeu = true }
}
return removeu
}

const dataSP = ts => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

// 5h, 1h30min, 45min
const fmtDurOpenGp = ms => {
const totalMin = Math.max(0, Math.ceil(ms / 60000))
const h = Math.floor(totalMin / 60), mi = totalMin % 60
return (h ? `${h}h` : '') + (mi || !h ? `${h && mi ? String(mi).padStart(2, '0') : mi}min` : '')
}

// "hoje às 21:30", "amanhã às 06:00", "04/10 às 06:00"
const fmtQuandoOpenGp = ts => {
const hora = new Date(ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit' })
const dia = dataSP(ts)
if(dia === dataSP(Date.now())) return `hoje às ${hora}`
if(dia === dataSP(Date.now() + 86400000)) return `amanhã às ${hora}`
const [, mes, d] = dia.split('-')
return `${d}/${mes} às ${hora}`
}

// Confere no WhatsApp se o grupo realmente ficou aberto (true = aberto, false = ainda fechado, null = não deu para conferir)
const grupoEstaAberto = async (diablo, jid) => {
try {
await new Promise(r => setTimeout(r, 800))
const md = await diablo.group.queryGroupMetadata(jid)
if(!md || (md.announce === undefined && md.isAnnounce === undefined)) return null
return !(md.announce || md.isAnnounce)
} catch { return null }
}

// A biblioteca expõe diablo.group.setSetting(jid, configuração, ligado). Para ABRIR o grupo desliga-se o "announcement".
// Cada tentativa é conferida no WhatsApp; se rodar mas o grupo continuar fechado, passa para a próxima.
const abrirGrupoApi = async (diablo, jid) => {
const tentativas = [
['setSetting', [jid, 'announcement', false]], ['setSetting', [jid, 'announce', false]],
['setSetting', [jid, 'announcement', 'off']], ['setSetting', [jid, 'announcement', 0]],
['setAnnounce', [jid, false]], ['setAnnouncement', [jid, false]], ['setGroupAnnounce', [jid, false]],
['setAnnouncementMode', [jid, false]], ['setMessagesAdminsOnly', [jid, false]], ['setAdminsOnly', [jid, false]],
['groupSettingUpdate', [jid, 'not_announcement']], ['updateSetting', [jid, 'not_announcement']],
['openGroup', [jid]], ['open', [jid]], ['unlock', [jid]]
]
const erros = []
for(const alvoApi of [diablo?.group, diablo]) {
if(!alvoApi) continue
for(const [nome, args] of tentativas) {
if(typeof alvoApi[nome] !== 'function') continue
const rotulo = `${nome}(${args.slice(1).join(', ')})`
try {
await alvoApi[nome](...args)
if(await grupoEstaAberto(diablo, jid) === false) { erros.push(`${rotulo}: rodou, mas o grupo continua fechado`); continue }
return { ok: true, via: rotulo }
} catch(e) { erros.push(`${rotulo}: ${e?.message || e}`) }
}
}
return { ok: false, erros, disponiveis: Object.keys(diablo?.group || {}) }
}

const executarOpenGp = async (diablo, jid, cfg = {}) => {
const r = await abrirGrupoApi(diablo, jid)
if(!r.ok) {
console.log('[OPENGP] não consegui abrir o grupo', jid, '| erros:', r.erros, '| métodos em diablo.group:', r.disponiveis)
return r
}
console.log('[OPENGP] grupo aberto via', r.via, '|', jid)
const padrao = '*🔓 GRUPO ABERTO!* ✨\n\n_O grupo foi aberto automaticamente._'
const legenda = cfg.legenda === '0' ? '' : (cfg.legenda || padrao)
const midiaSalva = acharMediaOpenGp(jid)
try {
if(midiaSalva) {
const dados = fs.readFileSync(midiaSalva.arquivo)
await diablo.message.send(jid, { type: midiaSalva.tipo, media: dados, mimetype: midiaSalva.mimetype, ...(legenda ? { caption: legenda } : {}) })
} else if(legenda) {
await diablo.message.send(jid, { type: 'text', text: legenda })
}
} catch(e) { console.log('[OPENGP] grupo aberto, mas falhou ao enviar a mensagem:', e?.message || e) }
return r
}

const verificarOpenGp = async () => {
if(OPENGP_RODANDO || !DIABLO_OPENGP) return
OPENGP_RODANDO = true
try {
const pasta = path.join(__dirname, 'dados', 'grupos')
if(!fs.existsSync(pasta)) return
for(const nome of fs.readdirSync(pasta)) {
if(!nome.endsWith('.json')) continue
const arq = path.join(pasta, nome)
let lista
try { lista = JSON.parse(fs.readFileSync(arq, 'utf8')) } catch { continue }
const gp = lista?.[0]
const og = gp?.opengp
if(!og?.ativo || !og.abrirEm || !gp.groupId || Date.now() < og.abrirEm) continue
og.ativo = false // desliga antes (síncrono): a contagem roda uma vez só
og.abrirEm = null
fs.writeFileSync(arq, JSON.stringify(lista, null, 2))
const r = await executarOpenGp(DIABLO_OPENGP, gp.groupId, og)
if(!r.ok) await DIABLO_OPENGP.message.send(gp.groupId, { type: 'text', text: '*❌ Não consegui abrir o grupo automaticamente.* Confirme se eu sou admin do grupo.' }).catch(() => {})
}
} catch(e) {
console.log('[OPENGP] erro no agendador:', e?.message || e)
} finally {
OPENGP_RODANDO = false
}
}

//==========[ função de Abrir e fecha gp]============\\

const fecharGrupoApi = async (diablo, jid) => {
const tentativas = [
['setSetting', [jid, 'announcement', true]], ['setSetting', [jid, 'announce', true]],
['setSetting', [jid, 'announcement', 'on']], ['setSetting', [jid, 'announcement', 1]],
['setAnnounce', [jid, true]], ['setAnnouncement', [jid, true]], ['setGroupAnnounce', [jid, true]],
['setAnnouncementMode', [jid, true]], ['setMessagesAdminsOnly', [jid, true]], ['setAdminsOnly', [jid, true]],
['groupSettingUpdate', [jid, 'announcement']], ['updateSetting', [jid, 'announcement']],
['closeGroup', [jid]], ['close', [jid]], ['lock', [jid]]
]
const erros = []
for(const alvoApi of [diablo?.group, diablo]) {
if(!alvoApi) continue
for(const [nome, args] of tentativas) {
if(typeof alvoApi[nome] !== 'function') continue
const rotulo = `${nome}(${args.slice(1).join(', ')})`
try {
await alvoApi[nome](...args)
if(await grupoEstaAberto(diablo, jid) === true) { erros.push(`${rotulo}: rodou, mas o grupo continua aberto`); continue }
return { ok: true, via: rotulo }
} catch(e) { erros.push(`${rotulo}: ${e?.message || e}`) }
}
}
return { ok: false, erros, disponiveis: Object.keys(diablo?.group || {}) }
}

//=============[ ACEITAR SOLICITAÇÕES / AUSENTE ]=============\\

const solicitacaoJid = it => typeof it === 'string' ? it : (it?.jid || it?.phone_number || it?.phoneNumber || it?.pnJid || it?.id || '')

// A biblioteca expõe métodos em diablo.group, mas o nome dos de "solicitações de entrada" não é conhecido:
// procura por nome (request / solicit / approve / accept...) e confere no WhatsApp se as pendentes diminuíram.
const aceitarSolicitacoesApi = async (diablo, jid) => {
const g = diablo?.group || {}
const nomes = Object.keys(g).filter(n => typeof g[n] === 'function')
const relacionados = nomes.filter(n => /request|solicit|pending|approv|accept|aceit/i.test(n))
const listadores = relacionados.filter(n => /list|query|get|pending|fetch/i.test(n))
const atualizadores = relacionados.filter(n => /update|handle|approv|accept|respond|action|aceit/i.test(n))
const erros = []

const listar = async () => {
for(const n of listadores) {
try {
const r = await g[n](jid)
if(Array.isArray(r)) return { via: n, jids: r.map(solicitacaoJid).filter(Boolean) }
} catch(e) { erros.push(`${n}: ${e?.message || e}`) }
}
return null
}

const antes = await listar()
if(!antes) return { ok: false, erros, relacionados, nomes, motivo: 'listar' }
if(!antes.jids.length) return { ok: true, vazio: true, aceitos: 0 }

for(const n of atualizadores) {
for(const args of [[jid, antes.jids, 'approve'], [jid, antes.jids], [jid, antes.jids, 'accept'], [jid, antes.jids, true]]) {
try {
await g[n](...args)
const depois = await listar()
const restantes = depois ? depois.jids.length : 0
if(depois && restantes >= antes.jids.length) { erros.push(`${n}(${args.slice(1).map(x => Array.isArray(x) ? 'jids' : x).join(', ')}): rodou, mas as solicitações continuam pendentes`); continue }
return { ok: true, aceitos: antes.jids.length - restantes, via: n }
} catch(e) { erros.push(`${n}(${args.slice(1).map(x => Array.isArray(x) ? 'jids' : x).join(', ')}): ${e?.message || e}`) }
}
}
return { ok: false, erros, relacionados, nomes, motivo: 'aprovar' }
}

const fmtOffline = ms => {
const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sg = Math.floor(ms % 60000 / 1000), mil = Math.floor(ms % 1000)
const u = (n, sing, plu) => `${n} ${n === 1 ? sing : plu}`
return `${u(h, 'hora', 'horas')}, ${u(m, 'minuto', 'minutos')}, ${u(sg, 'segundo', 'segundos')} e ${u(mil, 'milissegundo', 'milissegundos')}.`
}

const textoVoltou = (nr, aus) => `*Bem vindo de volta✨*\n\n*💋 Usuário: @${nr}*\n*💬 Motivo: ${aus.motivo || 'Sem motivo especificado'}*\n*⏳ Tempo Offline: ${fmtOffline(Date.now() - (aus.desde || Date.now()))}*`

//=============[ CONTAGEM DE MENSAGENS (BANGHOST) ]=============\\

const CONTAGEM_DIR = path.join(__dirname, 'dados', 'contagem')
const CONTAGEM = new Map() // grupo -> { desde, msgs: { numero: quantidade } }
let CONTAGEM_SUJA = false
const arqContagem = gid => path.join(CONTAGEM_DIR, `${String(gid).replace(/[\\/]/g, '_')}.json`)
const contagemGrupo = gid => {
if(!CONTAGEM.has(gid)) {
let dados = null
try { dados = JSON.parse(fs.readFileSync(arqContagem(gid), 'utf8')) } catch {}
CONTAGEM.set(gid, dados && dados.msgs ? dados : { desde: Date.now(), msgs: {} })
}
return CONTAGEM.get(gid)
}
const contarMensagem = (gid, chave) => {
const c = contagemGrupo(gid)
c.msgs[chave] = (c.msgs[chave] || 0) + 1
CONTAGEM_SUJA = true
}
const contarComando = (gid, chave) => {
const c = contagemGrupo(gid)
c.cmds = c.cmds || {}
c.cmds[chave] = (c.cmds[chave] || 0) + 1
CONTAGEM_SUJA = true
}
const salvarContagem = () => {
if(!CONTAGEM_SUJA) return
CONTAGEM_SUJA = false
try {
fs.mkdirSync(CONTAGEM_DIR, { recursive: true })
for(const [gid, c] of CONTAGEM) fs.writeFileSync(arqContagem(gid), JSON.stringify(c))
} catch(e) { console.log('[CONTAGEM] não consegui salvar:', e?.message || e) }
}
setInterval(salvarContagem, 5000).unref?.()
process.on('exit', salvarContagem)

//=============[ BRINCADEIRAS ]=============\\

const BRINCADEIRAS = {
  gay: { emoji: '🌈', label: 'Gay', frases: [
  [0, 20, "Quase hétero 👀"],
  [21, 40, "Tem um jeitinho... 🤨"],
  [41, 60, "Suspeito demais 😏"],
  [61, 80, "Bandeira já tá tremulando 🏳️\u200d🌈"],
  [81, 100, "MORA NA PARADA GAY 🏳️\u200d🌈🔥"]
  ] },
  bv: { emoji: '💋', label: 'BV', frases: [
  [0, 20, "Ainda tem esperança 🙏"],
  [21, 40, "Tá começando a virar... 😬"],
  [41, 60, "Já tá na metade do caminho 😅"],
  [61, 80, "Quase confirmado 👀"],
  [81, 100, "BV CERTIFICADO COM LOUVOR 💋🏆"]
  ] },
  lesbica: { emoji: '🌈', label: 'Lésbica', frases: [
  [0, 20, "Hétero demais por enquanto 😅"],
  [21, 40, "Tem umas tendências aí... 🤔"],
  [41, 60, "Tá na dúvida 🌈"],
  [61, 80, "Quase confirmada 💅"],
  [81, 100, "LÉSBICA RAIZ 🏳️\u200d🌈✅"]
  ] },
  lula: { emoji: '🦑', label: 'Petista', frases: [
  [0, 20, "Ainda tem salvação 🙏"],
  [21, 40, "Já tá ouvindo o hino do PT 🎵"],
  [41, 60, "Metade vermelho já 🟥"],
  [61, 80, "Bolso cheio de estrelinhas ⭐"],
  [81, 100, "LULA LIVRE GRITANDO 🦑🔴"]
  ] },
  ciumento: { emoji: '😈', label: 'Ciumento', frases: [
  [0, 20, "Tranquilão, quase um Buda 😌"],
  [21, 40, "Dá uma olhadinha de vez em quando 👀"],
  [41, 60, "Já checou o celular hoje? 📱"],
  [61, 80, "Rastreamento ativo 24h 😤"],
  [81, 100, "CIÚME PATOLÓGICO NÍVEL DEUS 😈🔥"]
  ] },
  corno: { emoji: '💔', label: 'Corno', frases: [
  [0, 20, "Fiel que só o cachorro 🐶"],
  [21, 40, "Tem uns chifrinho nascendo... 🌱"],
  [41, 60, "Metade do chifre já apareceu 🙈"],
  [61, 80, "Quase um alce 🦌"],
  [81, 100, "CORNO RAIZ COM CHIFRE DE TOURO 🐂🏆"]
  ] },
  vesgo: { emoji: '👀', label: 'Vesgo', frases: [
  [0, 20, "Visão 20/20 😎"],
  [21, 40, "Um olhinho meio torto 👁️"],
  [41, 60, "Precisa de óculos urgente 🥴"],
  [61, 80, "Vê duas coisas ao mesmo tempo 😵"],
  [81, 100, "MIRA EM UM ACERTA O OUTRO 👀💥"]
  ] },
  bebado: { emoji: '🍺', label: 'Bêbado', frases: [
  [0, 20, "Seco que só o deserto 🌵"],
  [21, 40, "Uma cervejinha depois do serviço 🍺"],
  [41, 60, "Já tá na terceira dose 🥃"],
  [61, 80, "Tá dançando sozinho no canto 🕺"],
  [81, 100, "NÃO CONSEGUE ANDAR EM LINHA RETA 🍺🌀"]
  ] },
  preguicoso: { emoji: '😴', label: 'Preguiçoso', frases: [
  [0, 20, "Formiguinha trabalhadora 🐜"],
  [21, 40, "Só enrola um pouquinho 😅"],
  [41, 60, "Deixa pra amanhã o que pode hoje 😪"],
  [61, 80, "O sofá é o escritório 🛋️"],
  [81, 100, "PREGUIÇA DE ATÉ RESPIRAR 😴💤"]
  ] },
  corajoso: { emoji: '🦁', label: 'Corajoso', frases: [
  [0, 20, "Tremeu só de ler isso 😨"],
  [21, 40, "Corajoso quando tem alguém do lado 😬"],
  [41, 60, "Metade herói, metade covarde 🦸"],
  [61, 80, "Enfrenta os problemas de frente 💪"],
  [81, 100, "LEÃO RAIZ, NÃO TEME NADA 🦁🔥"]
  ] },
  feio: { emoji: '🤢', label: 'Feio', frases: [
  [0, 20, "Bonito que só um ator 😍"],
  [21, 40, "Passável com boa iluminação 💡"],
  [41, 60, "Nem feio nem bonito, assim assim 😐"],
  [61, 80, "Até o espelho desvia o olhar 🪞"],
  [81, 100, "ASSUSTOU ATÉ A CÂMERA 🤢📷"]
  ] },
  gostoso: { emoji: '🔥', label: 'Gostoso', frases: [
  [0, 20, "Ainda tá no processo 😅"],
  [21, 40, "Tem algo aí... 👀"],
  [41, 60, "Chamando atenção no rolê 😏"],
  [61, 80, "Tá quente demais 🌡️"],
  [81, 100, "GOSTOSO CERTIFICADO 🔥🏆"]
  ] },
  gostosa: { emoji: '💃', label: 'Gostosa', frases: [
  [0, 20, "Ainda tá no processo 😅"],
  [21, 40, "Tem algo aí... 👀"],
  [41, 60, "Chamando atenção no rolê 😏"],
  [61, 80, "Tá quente demais 🌡️"],
  [81, 100, "GOSTOSA CERTIFICADA 💃🏆"]
  ] },
  chato: { emoji: '😒', label: 'Chato', frases: [
  [0, 20, "Animadão de mais 🎉"],
  [21, 40, "Às vezes enjoa um pouco 😑"],
  [41, 60, "Metade do grupo já deu unfollow 😶"],
  [61, 80, "Até o eco cansou de ouvir 📢"],
  [81, 100, "CHATO PROFISSIONAL NÍVEL MAX 😒💤"]
  ] },
  chorao: { emoji: '😭', label: 'Chorão', frases: [
  [0, 20, "Pedra no peito 🪨"],
  [21, 40, "Uma lágrima aqui e ali 😢"],
  [41, 60, "Chora em filme de animação 🎬"],
  [61, 80, "Chora de alegria, tristeza e tédio 😭"],
  [81, 100, "TORNEIRA ABERTA 24H 😭🌊"]
  ] },
  perturbado: { emoji: '🌀', label: 'Perturbado', frases: [
  [0, 20, "Normal que só 😊"],
  [21, 40, "Tem uns pensamentos estranhos às 3h 🌙"],
  [41, 60, "Metade louco, metade gênio 🤔"],
  [61, 80, "Conversa com o ventilador 🌀"],
  [81, 100, "COMPLETAMENTE FORA DA REALIDADE 🌀🚀"]
  ] },
  rico: { emoji: '💰', label: 'Rico', frases: [
  [0, 20, "Conta no vermelho 😬"],
  [21, 40, "Tem uns trocados guardados 🪙"],
  [41, 60, "Classe média sofrida 😅"],
  [61, 80, "Tá bem de vida sim 💸"],
  [81, 100, "MILIONÁRIO CERTIFICADO 💰🏆"]
  ] },
  pobre: { emoji: '💸', label: 'Pobre', frases: [
  [0, 20, "Cheio da grana, tranquilo 💰"],
  [21, 40, "Apertozinho no fim do mês 😅"],
  [41, 60, "Pix de 5 reais no vermelho 😬"],
  [61, 80, "Come miojo com água do vizinho 🍜"],
  [81, 100, "TÃO POBRE QUE O BANCO BLOQUEOU POR DÓ 💸😭"]
  ] },
  gado: { emoji: '🐂', label: 'Gado', frases: [
  [0, 20, "Digno, não cai em besteira 😎"],
  [21, 40, "Dá uns mimos aqui e ali 🤏"],
  [41, 60, "Faz tudo que mandam 😶"],
  [61, 80, "Comprou presentão e levou chifre 🎁🐂"],
  [81, 100, "GADO RAIZ, MUGIU ATÉ AGORA 🐂🏆"]
  ] }
}

const { mensagemTemPagamento, defenderContraPagamento } = require('./dados/lib/antipayment.js')


//=============[ SELO VERIFICADO GLOBAL ]=============\\

const ARQ_NECESSARIOS = path.join(__dirname, 'dados', 'necessarios.json')

function lerNecessarios() {
const padrao = { verificado: 1 }
try {
if(!fs.existsSync(ARQ_NECESSARIOS)) {
fs.writeFileSync(ARQ_NECESSARIOS, JSON.stringify(padrao, null, 2))
return { ...padrao }
}
const atual = JSON.parse(fs.readFileSync(ARQ_NECESSARIOS, 'utf8'))
return { ...padrao, ...(atual || {}) }
} catch {
return { ...padrao }
}
}

function salvarNecessarios(data) {
fs.writeFileSync(ARQ_NECESSARIOS, JSON.stringify(data, null, 2))
}

function verificadoLigado(valor) {
return valor === true || Number(valor) === 1 || String(valor).toLowerCase() === 'true'
}

function criarSeloMeta(nomeExibido = 'nero') {
const displayName = String(nomeExibido || NomeDoBot || 'nero')
return {
key: {
participant: '13135550002@s.whatsapp.net',
remoteJid: 'status@broadcast',
fromMe: false,
id: 'DIABLO-VERIFICADO'
},
message: {
contactMessage: {
displayName,
vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${displayName};;;\nFN:${displayName}\nitem1.TEL;waid=13135550002:13135550002\nitem1.X-ABLabel:Verificado\nEND:VCARD`,
contextInfo: {
forwardingScore: 1,
isForwarded: true
}
}
}
}
}

//=============[ ERROS ]=============\\

process.on('uncaughtException', err => {
console.error((new Date()).toUTCString() + ' uncaughtException:', err.message)
console.error(err.stack)
})

//=============[ INÍCIO ]=============\\

async function startdiablo(diablo, info, evento = 'message') {

DIABLO_OPENGP = diablo
if(!OPENGP_TIMER) {
OPENGP_TIMER = setInterval(verificarOpenGp, 20000)
setTimeout(verificarOpenGp, 5000)
}

let necessarios = lerNecessarios()
let isVerificado = verificadoLigado(necessarios.verificado)
const seloEvento = isVerificado ? criarSeloMeta(NomeDoBot || 'nero') : null

//=============[ EVENTOS DO GRUPO ]=============\\

if(evento === 'group') {
const from = info?.groupJid || ''
const acao = info?.action || ''
if(!from || !['add', 'remove', 'promote', 'demote'].includes(acao)) return

const dirGroup = path.join(__dirname, 'dados', 'grupos', `${String(from).replace(/[\\/]/g, '_')}.json`)
if(!fs.existsSync(dirGroup)) return

let dataGp
try { dataGp = JSON.parse(fs.readFileSync(dirGroup, 'utf8')) } catch { return }
if(!Array.isArray(dataGp) || !dataGp[0]) return

let groupMetadata
try { groupMetadata = await diablo.group.queryGroupMetadata(from) } catch { return }

const groupName = groupMetadata?.subject || dataGp[0]?.name || 'Grupo'
const groupDesc = groupMetadata?.desc || ''
const groupMembers = groupMetadata?.participants || []
const cred = diablo.getCredentials?.() || {}
const botNumber = cred.meJid || ''

const padrao = {
name: groupName,
groupId: from,
x9: false,
antiimg: false,
antiloc: false,
anticontato: false,
antivideo: false,
antiaudio: false,
antisticker: false,
antilink: false,
advlink: false,
advlinkgp: false,
autosticker: false,
antiflood: false,
advflood: false,
antifake: false,
antinotas: false,
antipalavra: false,
antidoc: false,
anticatalogo: false,
advertencias: {},
mutados: {},
palavroes: [],
listanegra: [],
autoresposta: false,
antilinkgp: false,
antipayment: true,
soadm: false,
wellcome: [{
bemvindo1: false,
legendabv1: '0',
legendasaiu1: '0',
fundobv: null,
fundobv_tipo: null,
fundosaiu: null,
fundosaiu_tipo: null
}]
}

dataGp[0] = { ...padrao, ...dataGp[0], name: groupName, groupId: from }
if(!Array.isArray(dataGp[0].wellcome)) dataGp[0].wellcome = padrao.wellcome
if(!dataGp[0].wellcome[0]) dataGp[0].wellcome[0] = padrao.wellcome[0]
dataGp[0].wellcome[0] = { ...padrao.wellcome[0], ...dataGp[0].wellcome[0] }
// relê o arquivo agora: durante o await acima o admin pode ter ligado/desligado algo, e gravar a cópia antiga desfaria isso
try {
const atual = JSON.parse(fs.readFileSync(dirGroup, 'utf8'))
if(Array.isArray(atual) && atual[0]) {
atual[0] = { ...padrao, ...atual[0], name: groupName, groupId: from }
if(!Array.isArray(atual[0].wellcome) || !atual[0].wellcome[0]) atual[0].wellcome = padrao.wellcome
atual[0].wellcome[0] = { ...padrao.wellcome[0], ...atual[0].wellcome[0] }
dataGp = atual
}
} catch {}
fs.writeFileSync(dirGroup, JSON.stringify(dataGp, null, 2))

//=============[ DONO DO GRUPO (SÓ ELE PROMOVE/REBAIXA) ]=============\\

if((acao === 'demote' || acao === 'promote') && dataGp[0].donogp?.ids?.length) {
try {
const decisao = analisarAdmin({ registro: dataGp[0].donogp, info, groupMembers, botNumber, ownerNumber })
if(decisao) {
const botGp = achar(groupMembers, botNumber)
const donoJid = dataGp[0].donogp.jid
const opcoesDono = { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [...decisao.mencionar, donoJid] }
const lista = decisao.desfazer.map(j => `@${numero(j)}`).join(', ')
const nAutor = decisao.punir ? numero(decisao.punir) : ''
const nDono = numero(donoJid)

if(!(botGp?.isAdmin || botGp?.isSuperAdmin)) {
await diablo.message.send(from, { type: 'text', text: `*⚠️ Alteração de ADM não autorizada (${lista}), mas eu não sou admin para desfazer.*` }, opcoesDono).catch(() => {})
} else {
if(decisao.acao === 'demote') await diablo.group.promoteParticipants(from, decisao.desfazer).catch(e => console.log('[DONOGP] não consegui restaurar o ADM:', e?.message || e))
else await diablo.group.demoteParticipants(from, decisao.desfazer).catch(e => console.log('[DONOGP] não consegui desfazer a promoção:', e?.message || e))

if(decisao.punir && !decisao.punirSuperAdmin) await diablo.group.demoteParticipants(from, [decisao.punir]).catch(e => console.log('[DONOGP] não consegui rebaixar o autor:', e?.message || e))

let aviso = `*🛡️ ᴘʀᴏᴛᴇᴄᴀᴏ ᴅᴏ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ!*\n\n`
if(decisao.punir) {
const verbo = decisao.acao === 'demote' ? 'rebaixar' : 'promover'
const desfeito = decisao.acao === 'demote' ? 'O cargo foi restaurado' : 'A promoção foi desfeita'
aviso += `*@${nAutor} tentou ${verbo} ${lista}.*\n> Somente o dono do grupo (@${nDono}) pode promover ou rebaixar admins.\n> ${desfeito}${decisao.punirSuperAdmin ? `. @${nAutor} é o criador do grupo e não pode perder o ADM.` : ` e @${nAutor} perdeu o ADM.`}`
} else {
aviso += `*${lista} foi rebaixado.*\n> Não consegui identificar quem fez isso, mas o cargo foi restaurado.`
}
await diablo.message.send(from, { type: 'text', text: aviso }, opcoesDono).catch(() => {})
}
}
} catch(e) {
console.log('[DONOGP] erro:', e?.message || e)
}
}

//=============[ X9.2 ]=============\\
async function enviarX9Adm(sock, {
  chatJid,
  acao,
  usuario,
  administrador,
  nomeAdmin
}) {
  const titulo = acao === 'promote'
    ? '*X9-ADM ATIVO COM SUCESSO🙅‍♀️⚔️*'
    : '*X9-ADM ATIVO COM SUCESSO🙅‍♀️⚔️*';

  const texto = acao === 'promote'
    ? `*⏤͟͟͞͞O participante* -〘 @${numero(usuario)} 〙 *foi promovido a cargo de adm do grupo 👑 pelo admin* - 〘 @${nomeAdmin} 〙`
    : `*⏤͟͟͞͞O administrador* -〘 @${numero(usuario)} 〙 *foi rebaixado para membro comum 💨 pelo admin* - 〘 @${nomeAdmin} 〙`;

  const payMessage = {
    requestPaymentMessage: {
      currencyCodeIso4217: 'USD',
      amount1000: 1000,
      noteMessage: {
        extendedTextMessage: {
          text: `${titulo}\n\nMeu lugar\n\n${texto}`,
          contextInfo: {
            mentionedJid: [usuario, administrador].filter(Boolean),
            forwardingScore: 999,
            isForwarded: true
          }
        }
      },
      expiryTimestamp: 0
    }
  };

  const messageId = 'X9ADM' + Date.now();

  return await sock.relayMessage(
    chatJid,
    payMessage,
    { messageId }
  );
}

//=============[ X9 ADM ]=============\\

if (['promote', 'demote'].includes(acao)) {
  if (!dataGp[0].x9) return;

  const ator = achar(
    groupMembers,
    info?.authorJid,
    info?.author?.jid,
    info?.author
  );

  const adm = alvo(
    ator,
    info?.authorJid || info?.author?.jid || info?.author || ''
  );

  const nomeAdmin = adm
    ? numero(adm)
    : 'Desconhecido';

  for (const p of info?.participants || []) {
    const jid = typeof p === 'string'
      ? p
      : (
          p?.jid ||
          p?.phoneJid ||
          p?.pnJid ||
          p?.lidJid ||
          ''
        );

    const membro = achar(
      groupMembers,
      jid,
      p?.jid,
      p?.phoneJid,
      p?.pnJid,
      p?.lidJid
    );

    const usuario = alvo(membro, jid);

    if (!usuario) continue;

    try {
      // Necessário utilizar o socket original do Baileys.
      // Integrar aqui com o socket da conexão.
      await enviarX9Adm(sock, {
        chatJid: from,
        acao,
        usuario,
        administrador: adm,
        nomeAdmin
      });

    } catch (err) {
      console.error('[X9 ADM]', err.message);
    }
  }

  return;
}

//=============[ ANTI-FAKE (ENTRADA) ]=============\\

let participantesBv = info?.participants || []
if(acao === 'add' && antifakeAtivo(from)) {
const botGp = achar(groupMembers, botNumber)
if(botGp?.isAdmin || botGp?.isSuperAdmin) {
const restantes = []
for(const p of participantesBv) {
const jid = typeof p === 'string' ? p : (p?.jid || p?.phoneJid || p?.pnJid || p?.lidJid || '')
const membro = achar(groupMembers, jid, p?.jid, p?.phoneJid, p?.pnJid, p?.lidJid)
if(jid && antifakeAtivo(from) && ehEstrangeiro(p, membro, jid)) {
const user = alvo(membro, jid) || jid
console.log('[ANTIFAKE] removendo na entrada:', telefoneReal(p, membro, jid), 'grupo:', from)
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🚫 @${telefoneReal(p, membro, jid)} foi banido: números estrangeiros não são permitidos neste grupo.*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
} else restantes.push(p)
}
participantesBv = restantes
if(!participantesBv.length) return
}
}

//=============[ LISTA NEGRA (ENTRADA) ]=============\\

if(acao === 'add' && listaNegraDoGrupo(from).length) {
const botGp = achar(groupMembers, botNumber)
if(botGp?.isAdmin || botGp?.isSuperAdmin) {
const restantes = []
for(const p of participantesBv) {
const jid = typeof p === 'string' ? p : (p?.jid || p?.phoneJid || p?.pnJid || p?.lidJid || '')
const membro = achar(groupMembers, jid, p?.jid, p?.phoneJid, p?.pnJid, p?.lidJid)
const tel = telefoneReal(p, membro, jid)
if(jid && naListaNegra(listaNegraDoGrupo(from), tel, numero(jid))) {
const user = alvo(membro, jid) || jid
console.log('[LISTANEGRA] removendo na entrada:', tel || numero(jid), 'grupo:', from)
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🗡️ @${tel || numero(jid)} está na lista negra e foi banido assim que entrou!*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
} else restantes.push(p)
}
participantesBv = restantes
if(!participantesBv.length) return
}
}

//=============[ BEM-VINDO ]=============\\

const isWelkom = dataGp[0].wellcome[0].bemvindo1
if(!isWelkom || !['add', 'remove'].includes(acao)) return

const welcome = (n, gp) => `*ʙᴇᴍ-ᴠɪɴᴅᴏ @${n} ᴀᴏ ${gp}.*`
const bye = (n, gp) => `*@${n} sᴀɪᴜ ᴅᴏ ${gp}.*`

const perfil = async jid => {
try {
const pic = await diablo.profile.getProfilePicture(jid, 'image')
return pic?.url || ''
} catch { return '' }
}

const legenda = (txt, user) => {
const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
return String(txt || '')
.replace(/#hora#/gi, hora)
.replace(/#nomedogp#/gi, groupName)
.replace(/#numerodele#/gi, `@${numero(user)}`)
.replace(/#numerobot#/gi, numero(botNumber))
.replace(/#prefixo#/gi, prefix)
.replace(/#descrição#/gi, groupDesc)
.replace(/#descricao#/gi, groupDesc)
}

for(const p of participantesBv) {
const jid = typeof p === 'string' ? p : (p?.jid || p?.phoneJid || p?.pnJid || p?.lidJid || '')
const membro = achar(groupMembers, jid, p?.jid, p?.phoneJid, p?.pnJid, p?.lidJid)
const user = alvo(membro, jid) || jid
if(!user) continue

const bv = dataGp[0].wellcome[0]
const custom = acao === 'add' ? bv.legendabv1 : bv.legendasaiu1
const teks = String(custom || '0').trim() !== '0'
? legenda(custom, user)
: acao === 'add' ? welcome(numero(user), groupName) : bye(numero(user), groupName)

const fundo = acao === 'add' ? bv.fundobv : bv.fundosaiu
const tipo = acao === 'add' ? bv.fundobv_tipo : bv.fundosaiu_tipo

if(fundo) {
const media = Buffer.from(fundo, 'base64')

if(tipo === 'video' || tipo === 'gif') {
await diablo.message.send(from, {
type: 'video',
media,
mimetype: 'video/mp4',
caption: teks,
gifPlayback: true
}, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
continue
}

await diablo.message.send(from, {
type: 'image',
media,
mimetype: tipo === 'png' ? 'image/png' : 'image/jpeg',
caption: teks
}, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
continue
}

const foto = await perfil(user)
if(foto) {
try {
const media = await baixar(foto)
await diablo.message.send(from, {
type: 'image',
media,
mimetype: 'image/jpeg',
caption: teks
}, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] })
continue
} catch {}
}

await diablo.message.send(from, { type: 'text', text: teks }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
}
return
}

//=============[ MENSAGEM ]=============\\

const from = info.key?.remoteJid || ''
const grupo = !!info.key?.isGroup || from.endsWith('@g.us')
const status = !!info.key?.isBroadcast || from.endsWith('@broadcast')
if(!from || !info.message || status) return

//=============[ BODY ]=============\\

function texto(info) {
const rotas = [
'message.conversation',
'message.imageMessage.caption',
'message.videoMessage.caption',
'message.extendedTextMessage.text',
'message.documentWithCaptionMessage.message.documentMessage.caption',
'message.documentMessage.caption',
'message.buttonsResponseMessage.selectedButtonId',
'message.listResponseMessage.singleSelectReply.selectedRowId',
'message.templateButtonReplyMessage.selectedId',
'message.pollCreationMessageV3.name',
'message.editedMessage.message.protocolMessage.editedMessage.extendedTextMessage.text',
'message.editedMessage.message.protocolMessage.editedMessage.imageMessage.caption',
'message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson',
'text'
]

for(const rota of rotas) {
const valor = rota.split('.').reduce((obj, chave) => obj?.[chave], info)
if(!valor) continue

if(rota.includes('paramsJson')) {
try { return JSON.parse(valor)?.id || '' } catch { return '' }
}

return String(valor)
}

return ''
}

const body = texto(info)
const Procurar_String = body
const budy2 = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const cmd = body.startsWith(prefix)
const args = cmd ? body.slice(prefix.length).trim().split(/[ \t]+/).filter(Boolean) : body.split(/[ \t]+/).filter(Boolean)
let command = cmd ? String(args.shift() || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ç/g, 'c') : null
const q = args.join(' ')
const PR_String = Procurar_String.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const nome = info.pushName || 'Sem nome'
const sender = info.key?.participant || info.key?.remoteJid || ''
const alt = info.key?.participantAlt || info.key?.remoteJidAlt || ''

let selo = isVerificado ? criarSeloMeta(nome) : info

function atualizarSelo(valor) {
isVerificado = !!valor
necessarios.verificado = isVerificado ? 1 : 0
salvarNecessarios(necessarios)
selo = isVerificado ? criarSeloMeta(nome) : info
return selo
}

//=============[ GRUPO ]=============\\

let groupMetadata = null
let groupName = 'Privado'
let groupDesc = ''
let groupMembers = []

if(grupo) {
try {
groupMetadata = await diablo.group.queryGroupMetadata(from)
groupName = groupMetadata?.subject || 'Grupo'
groupDesc = groupMetadata?.desc || ''
groupMembers = groupMetadata?.participants || []
} catch { return }
}

//=============[ JSON DO GRUPO ]=============\\

const dirGroup = path.join(__dirname, 'dados', 'grupos', `${String(from).replace(/[\\/]/g, '_')}.json`)

const data_IDGP = [{
name: groupName,
groupId: from,
x9: false,
antiimg: false,
antiloc: false,
anticontato: false,
antivideo: false,
antiaudio: false,
antisticker: false,
antilink: false,
advlink: false,
advlinkgp: false,
autosticker: false,
antiflood: false,
advflood: false,
antifake: false,
antinotas: false,
antipalavra: false,
antidoc: false,
anticatalogo: false,
advertencias: {},
mutados: {},
palavroes: [],
listanegra: [],
autoresposta: false,
antilinkgp: false,
antipayment: true,
antibot: false,
antimarcar: false,
soadm: false,
wellcome: [{
bemvindo1: false,

legendabv1: `「👋」 #numerodele#

- *Seja bem-vindo(a) ao grupo!*

『👥』 Grupo: *#nomedogp#*

Ficamos felizes em ter você aqui.
Leia as regras e aproveite o grupo.`,

legendasaiu1: `「👋」 #numerodele#

- *Um membro saiu do grupo...*

『👥』 Grupo: *#nomedogp#*

Agradecemos pela participação.
Esperamos que volte algum dia.`,

fundobv: null,
fundobv_tipo: null,
fundosaiu: null,
fundosaiu_tipo: null
}]
}]

if(grupo && !fs.existsSync(dirGroup)) fs.writeFileSync(dirGroup, JSON.stringify(data_IDGP, null, 2))

let dataGp
if(grupo) {
try { dataGp = JSON.parse(fs.readFileSync(dirGroup, 'utf8')) }
catch { dataGp = data_IDGP; fs.writeFileSync(dirGroup, JSON.stringify(dataGp, null, 2)) }

if(!Array.isArray(dataGp) || !dataGp[0]) dataGp = data_IDGP
const padrao = data_IDGP[0]
dataGp[0] = { ...padrao, ...dataGp[0], name: groupName, groupId: from }
if(!Array.isArray(dataGp[0].wellcome)) dataGp[0].wellcome = padrao.wellcome
if(!dataGp[0].wellcome[0]) dataGp[0].wellcome[0] = padrao.wellcome[0]
dataGp[0].wellcome[0] = { ...padrao.wellcome[0], ...dataGp[0].wellcome[0] }
fs.writeFileSync(dirGroup, JSON.stringify(dataGp, null, 2))
}

function setGp(index) {
if(grupo) fs.writeFileSync(dirGroup, JSON.stringify(index, null, 2))
}

function setCfg(campo, valor) {
const cfg = path.join(__dirname, 'dados', 'config.json')
let data = {}
try { data = JSON.parse(fs.readFileSync(cfg, 'utf8')) } catch {}
data[campo] = valor
fs.writeFileSync(cfg, JSON.stringify(data, null, 2))
}

//=============[ ADMS/DONO/ETC..CONST ]=============\\

const cred = diablo.getCredentials?.() || {}
const botNumber = cred.meJid || ''
const autor = achar(groupMembers, sender, alt)
const bot = achar(groupMembers, botNumber)
const admin = !!(autor?.isAdmin || autor?.isSuperAdmin)
const botadm = !!(bot?.isAdmin || bot?.isSuperAdmin)
const dono = !!info.key?.fromMe || [sender, alt, info.key?.remoteJidAlt].some(jid => numero(jid) === String(ownerNumber || '').replace(/\D/g, '') && ownerNumber)
const isCargo = dono ? 'Mestre' : admin ? 'Administrador' : 'Membro'

//=============[ FUNÇÕES/ATIVAÇÕES ]=============\\

const isx9 = grupo ? dataGp[0].x9 : undefined
const isAntiImg = grupo ? dataGp[0].antiimg : undefined
const isAntiLoc = grupo ? dataGp[0].antiloc : undefined
const isAntiContato = grupo ? dataGp[0].anticontato : undefined
const isAntiVideo = grupo ? dataGp[0].antivideo : undefined
const isAntiAudio = grupo ? dataGp[0].antiaudio : undefined
const isAntiSticker = grupo ? dataGp[0].antisticker : undefined
const isAntiLink = grupo ? dataGp[0].antilink : undefined
const isAdvLink = grupo ? dataGp[0].advlink : undefined
const isAdvLinkGp = grupo ? dataGp[0].advlinkgp : undefined
const isAutoSticker = grupo ? dataGp[0].autosticker : undefined
const isAntiFlood = grupo ? dataGp[0].antiflood : undefined
const isAdvFlood = grupo ? dataGp[0].advflood : undefined
const isAntiFake = grupo ? dataGp[0].antifake : undefined
const isAntiNotas = grupo ? dataGp[0].antinotas : undefined
const isAntiPalavra = grupo ? dataGp[0].antipalavra : undefined
const isAntiDoc = grupo ? dataGp[0].antidoc : undefined
const isAntiCatalogo = grupo ? dataGp[0].anticatalogo : undefined
const isAutoResposta = grupo ? dataGp[0].autoresposta : undefined
const isAntiLinkGp = grupo ? dataGp[0].antilinkgp : undefined
const isAntiPayment = grupo ? dataGp[0].antipayment : undefined
const isAntiBot = grupo ? dataGp[0].antibot : undefined
const isAntiMarcar = grupo ? dataGp[0].antimarcar : undefined
const So_Adm = grupo ? dataGp[0].soadm : undefined
const isWelkom = grupo ? dataGp[0].wellcome[0].bemvindo1 : undefined

//=============[ FUNÇÕES DE MARCAÇÕES ESSENCIAL ]=============\\

const m = info.message || {}
const cita = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || m.audioMessage?.contextInfo || m.documentMessage?.contextInfo || m.stickerMessage?.contextInfo || {}
const menc_prt = cita.participantAlt || cita.participant || ''
const menc_jid2 = Array.isArray(cita.mentionedJid) ? [...cita.mentionedJid] : []
const menc_sticker = menc_jid2?.[0] || menc_prt || null
const busca = String(q || '')
const marcou = busca.includes('@')
const menc_os2 = marcou ? (menc_jid2?.[0] || menc_sticker || null) : (menc_prt || menc_sticker)
const menc_jid = menc_os2 || sender
const sender_ou_n = marcou ? (menc_jid2?.[0] || menc_sticker || sender) : (menc_prt || menc_sticker || sender)
const numClean = txt => String(txt || '').replace(/[()+\-\/\s]/g, '') + '@s.whatsapp.net'
const mrc_ou_numero = busca.length > 6 && !marcou ? numClean(busca) : (menc_prt || menc_sticker || sender)
const marc_tds = marcou ? menc_jid : busca.length > 6 && !marcou ? numClean(busca) : (menc_prt || menc_sticker || sender)
const menc_prt_nmr = busca.length > 12 && !marcou ? numClean(busca) : (menc_prt || menc_sticker || sender)

//=============[ REPLYS / MÍDIAS ]=============\\

const reply = async text => diablo.message.send(from, String(text || ' '), { quote: selo })

const imagem = async(id, file, caption = '', quote = selo) => {
const media = /^https?:\/\//i.test(String(file)) ? await baixar(file) : file
return diablo.message.send(id, { type: 'image', media, mimetype: 'image/jpeg', caption }, { quote })
}

const video = async(id, file, caption = '', quote = selo) => {
const media = /^https?:\/\//i.test(String(file)) ? await baixar(file) : file
return diablo.message.send(id, { type: 'video', media, mimetype: 'video/mp4', caption }, { quote })
}

const audio = async(id, file, quote = selo) => {
const media = /^https?:\/\//i.test(String(file)) ? await baixar(file) : file
return diablo.message.send(id, { type: 'audio', media, mimetype: 'audio/mpeg', ptt: false }, { quote })
}

const sticker = async(id, file, quote = selo) => {
const media = /^https?:\/\//i.test(String(file)) ? await baixar(file) : file
return diablo.message.send(id, { type: 'sticker', media, mimetype: 'image/webp' }, { quote })
}

const reagir = async(emoji, id = from) => diablo.message.send(id, { type: 'reaction', emoji, target: info })
const mentions = async(teks = '', mb = [], quote = selo) => diablo.message.send(from, { type: 'text', text: teks.trim() }, { quote, mentions: mb })

const mention = async(teks = '', quote = selo) => {
const lista = [...teks.matchAll(/@(\d{6,20})/g)].map(v => `${v[1]}@s.whatsapp.net`)
return diablo.message.send(from, { type: 'text', text: teks.trim() }, { quote, mentions: lista })
}

const mencimg = async(teks = '', file, mb = [], quote = selo) => {
const media = /^https?:\/\//i.test(String(file)) ? await baixar(file) : file
return diablo.message.send(from, { type: 'image', media, mimetype: 'image/jpeg', caption: teks.trim() }, { quote, mentions: mb })
}

const painel = async(opt = {}) => {
const { reaction = '🎉', caption = mess.error(), grupo: soGrupo = false, adm: soAdm = false, dono: soDono = false } = opt

try {
await reagir(reaction).catch(() => {})
if(soGrupo && !grupo) return reply(mess.onlyGroup())
if(soAdm && !admin && !dono) return reply(mess.onlyAdmins())
if(soDono && !dono) return reply(mess.onlyOwner())

const file = midia('fotomenu')
if(file.type === 'video') return diablo.message.send(from, { type: 'video', media: file.data, mimetype: file.mimetype, caption, gifPlayback: true }, { quote: selo })
if(file.type === 'image') return diablo.message.send(from, { type: 'image', media: file.data, mimetype: file.mimetype, caption }, { quote: selo })
return reply(caption)
} catch(e) {
console.log(e)
return reply(caption)
}
}

//=============[ isQuoted/consts ]=============\\

const content = JSON.stringify(m)
const isImage = !!m.imageMessage
const isVideo = !!m.videoMessage
const isAudio = !!m.audioMessage
const isSticker = !!m.stickerMessage
const isContact = !!m.contactMessage
const isLocation = !!m.locationMessage
const isDocument = !!m.documentMessage
const isMedia = isImage || isVideo || isAudio || isSticker || isDocument

const citado = cita.quotedMessage || null
const citadoTxt = JSON.stringify(citado || {})
const isQuotedMsg = !!citado && (!!citado?.conversation || !!citado?.extendedTextMessage)
const isQuotedImage = citadoTxt.includes('imageMessage')
const isQuotedVideo = citadoTxt.includes('videoMessage')
const isQuotedAudio = citadoTxt.includes('audioMessage')
const isQuotedSticker = citadoTxt.includes('stickerMessage')
const isQuotedDocument = citadoTxt.includes('documentMessage')
const isQuotedContact = citadoTxt.includes('contactMessage')
const isQuotedLocation = citadoTxt.includes('locationMessage')

if(!cmd && info.key?.fromMe) return

//=============[ INTERAÇÃO NO TERMUX ]=============\\

const user = chalk.white.bold(nome?.toUpperCase() || 'DESCONHECIDO')
const number = chalk.white(numero(alt || sender) || sender)
const chatType = grupo ? 'GRUPO' : 'PRIVADO'
const groupInfo = grupo ? `(${groupName})` : '(Privado)'

const typeMap = {
cmd: ['COMANDO', chalk.white(`${prefix}${command}`)],
image: ['MÍDIA', '🖼️ IMAGEM'],
video: ['MÍDIA', '🎞️ VÍDEO'],
audio: ['MÍDIA', '🎧 ÁUDIO'],
sticker: ['MÍDIA', '🔖 FIGURINHA'],
document: ['MÍDIA', '📄 DOCUMENTO'],
contact: ['MÍDIA', '👤 CONTATO'],
location: ['MÍDIA', '📍 LOCALIZAÇÃO']
}

const detected = cmd ? 'cmd' : isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : isSticker ? 'sticker' : isDocument ? 'document' : isContact ? 'contact' : isLocation ? 'location' : null
const msgType = detected ? typeMap[detected][0] : 'MENSAGEM'
const msgContent = detected ? typeMap[detected][1] : chalk.white((body || '').slice(0, 50) + ((body || '').length > 50 ? '...' : ''))

console.log(chalk.cyanBright(`╭──. ݁ ⛧ ₊ ⊹ . ݁ ˖ ❆ິ̸ . ݁──╮
|${grupo ? '👥 MENSAGEM NO GRUPO' : '👤 MENSAGEM NO PRIVADO'}
╰──. ݁ ⛧ ₊ ⊹ . ݁ ˖ ❆ິ̸ . ݁──╯
╭──. ݁ ⛧ ₊ ⊹ . ݁ ˖ ❆ິ̸ . ݁──╮
| 👤 USUÁRIO: ${user}
| 📱 NÚMERO: ${number}
| 💬 CHAT: ${chatType} ${groupInfo}
| 📨 TIPO: ${msgType}
| 📝 CONTEÚDO: ${msgContent}
╰──. ݁ ⛧ ₊ ⊹ 🍁 . ݁ ˖ ❆ິ̸ . ݁──╯`))

//=============[ SISTEMAS ]=============\\

if(grupo && dataGp) {
const user = alvo(autor, sender)
const linkgp = /(?:https?:\/\/)?chat\.whatsapp\.com\/[\w-]+/i.test(body)
const link = !linkgp && /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|me|co|br)(?:\/[^\s]*)?/i.test(body)

const punir = async tipo => {
if(admin || dono || !botadm || !user) return false
await diablo.message.send(from, { type: 'text', text: mess.anti(numero(user), tipo) }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
return true
}

if(isAntiPayment && !admin && !dono && botadm && user && mensagemTemPagamento(info)) {
const grupoFechado = !!(groupMetadata?.announce || groupMetadata?.isAnnounce)
await defenderContraPagamento({ diablo, from, user, info, grupoFechado })
return
}

//=============[ LISTA NEGRA (MENSAGENS) ]=============\\

if(grupo && user && !info.key?.fromMe && !admin && !dono && botadm && dataGp[0].listanegra?.length && naListaNegra(dataGp[0].listanegra, telefoneReal(autor, sender, alt, info.key?.participantAlt), numero(user))) {
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🗡️ @${numero(user)} está na lista negra e foi banido!*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
return
}

//=============[ CONTAGEM + MUTE ]=============\\

if(grupo && user && !info.key?.fromMe) {
contarMensagem(from, numero(user))
if(cmd && command) contarComando(from, numero(user))
if(dataGp[0].mutados?.[numero(user)] && !admin && !dono && botadm) {
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
return
}
}

//=============[ ANTI-FLOOD ]=============\\

if((isAntiFlood || isAdvFlood) && !info.key?.fromMe && !admin && !dono && botadm && user) {
const agora = Date.now()
const est = FLOOD.get(from)
const seguida = est && est.user === user && (agora - est.last) <= FLOOD_INTERVALO
const novo = { user, count: seguida ? est.count + 1 : 1, last: agora, msgs: [...(seguida ? est.msgs : []), info] }
FLOOD.set(from, novo)
if(novo.count > FLOOD_LIMITE) {
FLOOD.delete(from)
if(isAdvFlood) {
dataGp[0].advertencias = dataGp[0].advertencias || {}
const chave = numero(user)
const total = (dataGp[0].advertencias[chave] || 0) + 1
if(total >= 3) {
delete dataGp[0].advertencias[chave]; setGp(dataGp)
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🚫 @${chave} atingiu 3/3 advertências e foi banido por flood!*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
} else {
dataGp[0].advertencias[chave] = total; (dataGp[0].advJids = dataGp[0].advJids || {})[chave] = user; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*⚠️ @${chave}, não faça flood neste grupo!*\n• _Advertência ${total}/3, ao chegar em 3/3 você será banido._` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
}
await Promise.allSettled(novo.msgs.map(mensagem => diablo.message.send(from, { type: 'revoke', target: mensagem })))
return
}
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🚫 @${numero(user)} foi banido por flood (mais de ${FLOOD_LIMITE} mensagens seguidas).*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await Promise.allSettled(novo.msgs.map(mensagem => diablo.message.send(from, { type: 'revoke', target: mensagem })))
return
}
} else if((isAntiFlood || isAdvFlood) && !info.key?.fromMe) {
const est = FLOOD.get(from)
if(est) FLOOD.set(from, { user: null, count: 0, last: Date.now(), msgs: [] })
}

//=============[ ANTI-FAKE (MENSAGENS) ]=============\\

if(isAntiFake && antifakeAtivo(from) && !info.key?.fromMe && !admin && !dono && botadm && user && ehEstrangeiro(autor, sender, alt, info.key?.participantAlt)) {
console.log('[ANTIFAKE] removendo por mensagem:', telefoneReal(autor, sender, alt), 'grupo:', from)
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🚫 @${numero(user)} foi banido: números estrangeiros não são permitidos neste grupo.*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
return
}

//=============[ ANTI-NOTAS ]=============\\

if(isAntiNotas && !info.key?.fromMe && !admin && !dono && botadm && user && /\bnotas\b/.test(budy2)) {
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
await diablo.message.send(from, { type: 'text', text: `*🚫 @${numero(user)} foi banido por enviar mensagem com "notas".*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
return
}

//=============[ ANTI-BOT ]=============\\

const ehBot = i => {
const id = String(i.key?.id || '')
return (id.startsWith('BAE5') && id.length === 16) || (id.startsWith('3EB0') && id.length === 22)
}

if(isAntiBot && !info.key?.fromMe && !admin && !dono && botadm && user && ehBot(info)) {
await diablo.message.send(from, { type: 'text', text: `*🤖 @${numero(user)} ғᴏɪ ʙᴀɴɪᴅᴏ ᴘᴏʀ sᴇʀ ʙᴏᴛ.*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
return
}

//=============[ ANTI-MARCAR TODOS ]=============\\

const marcouTodos = groupMembers.length > 10 && (menc_jid2.length >= Math.ceil(groupMembers.length * 0.9) || Number(cita.nonJidMentions) > 0)

if(isAntiMarcar && !info.key?.fromMe && !admin && !dono && botadm && user && marcouTodos) {
await diablo.message.send(from, { type: 'text', text: `*📢 @${numero(user)} ғᴏɪ ʙᴀɴɪᴅᴏ ᴘᴏʀ ᴍᴀʀᴄᴀʀ ᴛᴏᴅᴏs ᴏs ᴘᴀʀᴛɪᴄɪᴘᴀɴᴛᴇs.*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
return
}

if(isAntiImg && isImage && await punir('ɪᴍᴀɢᴇᴍ')) return
if(isAntiLoc && (isLocation || !!m.liveLocationMessage) && await punir('ʟᴏᴄᴀʟɪᴢᴀᴄᴀᴏ')) return
if(isAntiPalavra && (temPalavrao(budy2) || temPalavraoCustom(budy2, dataGp[0].palavroes)) && await punir('ᴘᴀʟᴀᴠʀᴀᴏ')) return
if(isAntiDoc && (isDocument || !!m.documentWithCaptionMessage?.message?.documentMessage) && await punir('ᴅᴏᴄᴜᴍᴇɴᴛᴏ')) return
if(isAntiCatalogo && (!!m.productMessage || !!m.orderMessage || /wa\.me\/[cp]\/\d+/.test(budy2)) && await punir('ᴄᴀᴛᴀʟᴏɢᴏ')) return

//=============[ AUSENTE: VOLTOU ]=============\\

if(grupo && user && !info.key?.fromMe && !['ausente', 'afk', 'ativo'].includes(command) && dataGp[0].ausentes?.[numero(user)]) {
const aus = dataGp[0].ausentes[numero(user)]
delete dataGp[0].ausentes[numero(user)]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: textoVoltou(numero(user), aus) }, { quote: selo, mentions: [user] }).catch(() => {})
}

//=============[ AUTO-RESPOSTA ]=============\\

if(isAutoResposta && !cmd && budy2) {
const tabela = { ...AUTORESP_PADRAO, ...(dataGp[0].respostas || {}) }
const textoNorm = normGatilho(budy2)
const textoCol = ` ${colapsar(textoNorm)} ` // aceita "oiii", "boooa noite" etc.
const achou = Object.keys(tabela).find(g => g === 'kkkkk' ? /(^| )k{5,}( |$)/.test(textoNorm) : g && textoCol.includes(` ${colapsar(g)} `))
if(achou) {
const chaveCd = `${from}|${achou}`
const agoraAr = Date.now()
if(!AUTORESP_CD.has(chaveCd) || agoraAr - AUTORESP_CD.get(chaveCd) > AUTORESP_INTERVALO) {
AUTORESP_CD.set(chaveCd, agoraAr)
await reply(tabela[achou]).catch(() => {})
}
}
}

//=============[ RESPOSTA À PALAVRA "PREFIXO" ]=============\\

if(grupo && !cmd && !info.key?.fromMe && /^prefixo[\s?!.]*$/i.test(String(body || '').trim())) {
await reply(`- ᶻ 𝗓 𐰁 ,, ''『  ${prefix}  』
*╰┈➤ ᴇsᴛᴇ ᴇ́ ᴏ ᴍᴇᴜ ᴘʀᴇғɪxᴏ ᴀᴛᴜᴀʟ, ᴄᴏᴍ ᴇʟᴇ ᴠᴏᴄᴇ ᴘᴏᴅᴇ ᴀᴄᴇssᴀʀ ᴍᴇᴜs ᴄᴏᴍᴀɴᴅᴏs ᴀɴᴛɪɢᴏs ᴇ ɴᴏᴠᴏs.*
 ˚₊‧꒰ა ♱ ໒꒱ ‧₊˚
> ┆✮⃝.💀💀✮⃝ : :  ♱`).catch(() => {})
return
}

//=============[ AUTO STICKER ]=============\\

if(isAutoSticker && !cmd && !info.key?.fromMe && (isImage || isVideo) && !(isVideo && Number(m.videoMessage?.seconds) > 10)) {
;(async () => {
const pasta = path.join(__dirname, 'dados', 'media')
fs.mkdirSync(pasta, { recursive: true })
const base = path.join(pasta, `.auto-${Date.now()}-${Math.floor(Math.random() * 1e5)}`)
const entrada = base + (isVideo ? '.mp4' : '.jpg')
const saida = base + '.webp'
try {
await diablo.message.downloadToFile(m, entrada)
const modoFig = 'esticar' // 'esticar' = preenche tudo (distorce) | 'cortar' = preenche cortando as bordas | 'caber' = inteira, com bordas transparentes
const vf = {
esticar: 'scale=512:512,setsar=1,format=rgba',
cortar: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,format=rgba',
caber: 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000'
}[modoFig]
const argsff = isVideo
? ['-y', '-t', '6', '-i', entrada, '-vf', `fps=15,${vf}`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '45', '-compression_level', '6', '-loop', '0', '-an', saida]
: ['-y', '-i', entrada, '-vf', vf, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '70', '-an', '-frames:v', '1', saida]
await new Promise((ok, erro) => {
const ff = spawn('ffmpeg', ['-loglevel', 'error', ...argsff])
ff.on('error', erro)
ff.on('close', cod => cod === 0 ? ok() : erro(new Error('ffmpeg saiu com código ' + cod)))
})
await sticker(from, fs.readFileSync(saida), info)
} catch(e) {
console.log('[AUTOSTICKER] falhou:', e?.message || e)
} finally {
for(const f of [entrada, saida]) { try { fs.unlinkSync(f) } catch {} }
}
})()
}

if(isAntiContato && (isContact || !!m.contactsArrayMessage) && await punir('ᴄᴏɴᴛᴀᴛᴏ')) return
if(isAntiVideo && isVideo && await punir('ᴠɪᴅᴇᴏ')) return
if(isAntiAudio && isAudio && await punir('ᴀᴜᴅɪᴏ')) return
if(isAntiSticker && isSticker && await punir('ғɪɢᴜʀɪɴʜᴀ')) return
if(isAntiLinkGp && linkgp && await punir('ʟɪɴᴋ ᴅᴇ ɢʀᴜᴘᴏ')) return
if(isAntiLink && link && await punir('ʟɪɴᴋ')) return

//=============[ ADVERTÊNCIA POR LINK DE GRUPO ]=============\\

if(isAdvLinkGp && linkgp && !admin && !dono && botadm && user) {
dataGp[0].advertencias = dataGp[0].advertencias || {}
const chave = numero(user)
const total = (dataGp[0].advertencias[chave] || 0) + 1
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
if(total >= 3) {
delete dataGp[0].advertencias[chave]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🚫 @${chave} atingiu 3/3 advertências e foi banido por enviar links de grupos!*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
} else {
dataGp[0].advertencias[chave] = total; (dataGp[0].advJids = dataGp[0].advJids || {})[chave] = user; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*⚠️ @${chave}, links de grupos não são permitidos aqui!*\n• _Advertência ${total}/3, ao chegar em 3/3 você será banido._` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
}
return
}

//=============[ ADVERTÊNCIA POR LINK ]=============\\

if(isAdvLink && (link || linkgp) && !admin && !dono && botadm && user) {
dataGp[0].advertencias = dataGp[0].advertencias || {}
const chave = numero(user)
const total = (dataGp[0].advertencias[chave] || 0) + 1
await diablo.message.send(from, { type: 'revoke', target: info }).catch(() => {})
if(total >= 3) {
delete dataGp[0].advertencias[chave]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🚫 @${chave} atingiu 3/3 advertências e foi banido por enviar links no grupo!*` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
await diablo.group.removeParticipants(from, [user]).catch(() => {})
} else {
dataGp[0].advertencias[chave] = total; (dataGp[0].advJids = dataGp[0].advJids || {})[chave] = user; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*⚠️ @${chave}, links não são permitidos neste grupo!*\n• _Advertência ${total}/3, ao chegar em 3/3 você será banido._` }, { ...(seloEvento ? { quote: seloEvento } : {}), mentions: [user] }).catch(() => {})
}
return
}
if(So_Adm && cmd && !admin && !dono) return
}

if(cmd && !command) {
return reply(`╭─ ͡┄┄───────ׅ─ׅ─ׅ──ׂ─ׅ──────⟡
╎⋆.°❌ • ᴄᴏᴍᴀɴᴅᴏ ɪɴᴠᴀ́ʟɪᴅᴏ
╎
╎⋆.°📌 • ᴅɪɢɪᴛᴇ ᴜᴍ ᴄᴏᴍᴀɴᴅᴏ ᴀᴘᴏ́s ᴏ *${prefix}*
╎⋆.°📖 • ᴜsᴇ *${prefix}menu* ᴘᴀʀᴀ ᴠᴇʀ ᴏs ᴄᴏᴍᴀɴᴅᴏs
╰─͡┄┄───────ׂ─ׅ───ׂ─ׅ─ׅ──ׅ───⟡`)
}

if(!cmd) return

//=============[ SWITCH ]=============\\

switch(command) {

//=============[ MENUS ]=============\\

case 'menu':
case 'ajuda':
case 'menulista':
case 'listmenu': {
await reagir('✨').catch(() => {})

const menuFoto = midia('fotomenu')

const secoesMenu = [
{
title: '👾 PRINCIPAL',
rows: [
{ title: 'Ping', description: 'Ver velocidade e status do bot', id: `${prefix}ping` },
{ title: 'Criador', description: 'Ver informações do criador', id: `${prefix}criador` }
]
},
{
title: '👾 CATEGORIAS',
rows: [
  {
    title: '🎮 Brincadeiras',
    description: 'Jogos, diversão e entretenimento',
    id: `${prefix}menubrin`
  },
  {
    title: '📥 Downloads',
    description: 'Baixar músicas, vídeos e arquivos',
    id: `${prefix}menudown`
  },
  {
    title: '🎨 Logos',
    description: 'Criar logos e efeitos personalizados',
    id: `${prefix}menulogo`
  },
  {
    title: '🎭 Figurinhas',
    description: 'Criar, baixar e enviar figurinhas',
    id: `${prefix}menufig`
  },
  {
    title: '🛡️ Administração',
    description: 'Gerenciamento e controle do grupo',
    id: `${prefix}menuadm`
  },
  {
    title: '👑 Dono',
    description: 'Comandos exclusivos do proprietário',
    id: `${prefix}menudono`
  }
]
}
]
const card = {
text: `
━━━━ ${NomeDoBot || 'nero'}*
━━━━ USUÁRIO — ${nome}
━━━━ CARGO — ${isCargo}

Selecione uma categoria abaixo:`,
footer: 'nero',
buttons: [
{
type: 'single_select',
title: 'Abrir Menu',
sections: secoesMenu
}
]
}

if(menuFoto.type === 'image') {
card.image = menuFoto.data
card.imageMimetype = menuFoto.mimetype || 'image/jpeg'
}

if(menuFoto.type === 'video') {
card.video = menuFoto.data
card.videoMimetype = menuFoto.mimetype || 'video/mp4'
card.gifPlayback = true
}

try {
// A Zapo modificada é carregada diretamente da pasta ./zapo pela base.
// Portanto este envio é sempre o Menu List dentro de um card de carrossel.
await diablo.message.sendCarousel(from, {
viewOnce: true,
carouselCardType: 1,
cards: [card]
}, { quote: selo })
} catch(e) {
console.log(chalk.red('[ MENU LIST CARROSSEL ] ') + chalk.white(e?.stack || e?.message || e))
return reply(`❌ *Erro ao enviar o Menu List.*\n\n> ${e?.message || String(e)}`)
}
}
break

case 'menuadm':
case 'adm':
await painel({ reaction: '✨', caption: linguagem.adms(prefix), adm: true })
break

case 'menudown':
case 'downloads':
await painel({ reaction: '✨', caption: linguagem.menudown(prefix) })
break

case 'menubrin':
case 'brincadeiras':
case 'brincadeira':
case 'diversao':
await painel({ reaction: '✨', caption: linguagem.Brincadeiras(prefix) })
break

case 'menudono':
await painel({ reaction: '✨', caption: linguagem.menudono(prefix), dono: true })
break

case 'menulogo':
case 'logos':
await painel({ reaction: '✨', caption: linguagem.menulogo(prefix) })
break

case 'menufig':
case 'figurinhas':
await painel({ reaction: '✨', caption: linguagem.menufig(prefix) })
break
//=============[ FIGURINHA (IMAGEM / VÍDEO / GIF) ]=============\\

case 'figurinha':
case 'fig':
case 'sticker':
case 's': {
const fonte = citado || m
const media = fonte?.viewOnceMessage?.message || fonte?.viewOnceMessageV2?.message || fonte
const doc = media?.documentMessage || media?.documentWithCaptionMessage?.message?.documentMessage
const docMime = String(doc?.mimetype || '')
const imagemMsg = media?.imageMessage
const videoMsg = media?.videoMessage
const docVideo = /^(video\/|image\/gif)/i.test(docMime)
const docImagem = !docVideo && /^image\//i.test(docMime)
const ehVideo = !!videoMsg || docVideo
const ehImagem = !!imagemMsg || docImagem

if(!ehVideo && !ehImagem) return reply(`*ᴍᴀʀǫᴜᴇ ᴏᴜ ᴇɴᴠɪᴇ ᴜᴍᴀ ɪᴍᴀɢᴇᴍ, ᴠɪ́ᴅᴇᴏ ᴏᴜ ɢɪғ ᴄᴏᴍ ${prefix}${command}*\n\n> Opcional: ${prefix}${command} cortar | caber | esticar`)

const tamanho = Number((videoMsg || imagemMsg || doc)?.fileLength || 0)
if(tamanho > 20 * 1024 * 1024) return reply('*❌ ᴀʀǫᴜɪᴠᴏ ᴍᴜɪᴛᴏ ɢʀᴀɴᴅᴇ. ᴜsᴇ ᴀᴛᴇ́ 20ᴍʙ.*')

const modo = ['cortar', 'caber', 'esticar'].find(v => v === String(q || '').trim().toLowerCase()) || 'esticar'
const pasta = path.join(__dirname, 'dados', 'media')
fs.mkdirSync(pasta, { recursive: true })
const entrada = path.join(pasta, `.fig-${Date.now()}-${Math.floor(Math.random() * 1e5)}${ehVideo ? '.mp4' : '.jpg'}`)

try {
await reagir('⏳').catch(() => {})
await diablo.message.downloadToFile(media.documentWithCaptionMessage?.message || media, entrada)
const webp = await criarFigurinha(entrada, { animada: ehVideo, modo })
await sticker(from, webp, info)
await reagir('✅').catch(() => {})
} catch(e) {
console.log('[FIGURINHA] erro:', e?.message || e)
return reply('*❌ ɴᴀ̃ᴏ ғᴏɪ ᴘᴏssɪ́ᴠᴇʟ ᴄʀɪᴀʀ ᴀ ғɪɢᴜʀɪɴʜᴀ. ᴛᴇɴᴛᴇ ᴏᴜᴛʀᴀ ᴍɪ́ᴅɪᴀ.*')
} finally {
try { fs.unlinkSync(entrada) } catch {}
}
}
break

//=============[ TOGIF (FIGURINHA ANIMADA -> VÍDEO/GIF) ]=============\\

case 'togif':
case 'tovideo':
case 'tomp4': {
const msgFig = citado?.stickerMessage
if(!msgFig || msgFig.isAnimated === false) return reply('*Por favor, atribua uma figurinha animada à mensagem para realizar a conversão para vídeo/gif.*')

const pasta = path.join(__dirname, 'dados', 'media')
fs.mkdirSync(pasta, { recursive: true })
const entrada = path.join(pasta, `.togif-${Date.now()}-${Math.floor(Math.random() * 1e5)}.webp`)

try {
await reagir('⏳').catch(() => {})
await diablo.message.downloadToFile(citado, entrada)
const mp4 = await webpAnimadoParaMp4(fs.readFileSync(entrada))
await diablo.message.send(from, { type: 'video', media: mp4, mimetype: 'video/mp4', caption: '', gifPlayback: true }, { quote: info })
await reagir('✅').catch(() => {})
} catch(e) {
console.log('[TOGIF] erro:', e?.message || e)
if(e?.code === 'NAO_ANIMADA') return reply('*Por favor, atribua uma figurinha animada à mensagem para realizar a conversão para vídeo/gif.*')
return reply('*❌ ɴᴀ̃ᴏ ғᴏɪ ᴘᴏssɪ́ᴠᴇʟ ᴄᴏɴᴠᴇʀᴛᴇʀ ᴀ ғɪɢᴜʀɪɴʜᴀ.*')
} finally {
try { fs.unlinkSync(entrada) } catch {}
}
}
break

//=============[ TAKE (RENOMEAR FIGURINHA) ]=============\\

case 'take':
case 'renomear': {
const msgFig = citado?.stickerMessage
if(!msgFig) return reply('*• Você deve marcar uma figurinha para renomeá-la com sua marca d\'água. 🙇‍♀️*\n\n> Exemplo: marque a figurinha e envie ' + `${prefix}${command} Meu Pack | Meu Nome`)

const [packTxt, autorTxt] = String(q || '').split('|').map(v => v.trim())
const pack = packTxt || nome || 'Figurinha'
const autor = autorTxt || ''

const pasta = path.join(__dirname, 'dados', 'media')
fs.mkdirSync(pasta, { recursive: true })
const entrada = path.join(pasta, `.take-${Date.now()}-${Math.floor(Math.random() * 1e5)}.webp`)

try {
await reply('*Renomeando sticker com sua marca d\'água...💖*')
await diablo.message.downloadToFile(citado, entrada)
const nova = adicionarExif(fs.readFileSync(entrada), pack, autor)
await sticker(from, nova, info)
} catch(e) {
console.log('[TAKE] erro:', e?.message || e)
return reply('*❌ ɴᴀ̃ᴏ ғᴏɪ ᴘᴏssɪ́ᴠᴇʟ ʀᴇɴᴏᴍᴇᴀʀ ᴀ ғɪɢᴜʀɪɴʜᴀ.*')
} finally {
try { fs.unlinkSync(entrada) } catch {}
}
}
break

//=============[ DONO DO GRUPO (REGISTRO) ]=============\\

case 'donogp':
case 'setdonogp': {
if(!grupo) return reply(mess.onlyGroup())
if(!dono) return reply(mess.onlyOwner())

const atual = dataGp[0].donogp
const arg = String(q || '').trim().toLowerCase()

if(['0', 'off', 'remover', 'desativar'].includes(arg)) {
if(!atual) return reply('*ɴᴇɴʜᴜᴍ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ ʀᴇɢɪsᴛʀᴀᴅᴏ ᴀɪɴᴅᴀ.*')
delete dataGp[0].donogp
setGp(dataGp)
return reply('*🛡️ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ ʀᴇᴍᴏᴠɪᴅᴏ. ᴀ ᴘʀᴏᴛᴇᴄᴀᴏ ғᴏɪ ᴅᴇsᴀᴛɪᴠᴀᴅᴀ.*')
}

if(!menc_os2 && busca.length <= 6) {
if(!atual) return reply(`*🛡️ ɴᴇɴʜᴜᴍ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ ʀᴇɢɪsᴛʀᴀᴅᴏ.*\n\n> Use: ${prefix}${command} @admin\n> Remover: ${prefix}${command} 0`)
return diablo.message.send(from, { type: 'text', text: `*🛡️ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ:* @${numero(atual.jid)}\n\n> Remover: ${prefix}${command} 0` }, { quote: selo, mentions: [atual.jid] })
}
if(menc_jid2[1]) return reply(mess.semMencao())

const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
if(!membro.isAdmin && !membro.isSuperAdmin) return reply('*❌ ᴏ ᴜsᴜᴀʀɪᴏ ᴘʀᴇᴄɪsᴀ sᴇʀ ᴀᴅᴍ ᴅᴏ ɢʀᴜᴘᴏ ᴘᴀʀᴀ sᴇʀ ᴏ ᴅᴏɴᴏ.*')

const user = alvo(membro, marc_tds || menc_os2)
dataGp[0].donogp = guardarDono(membro, user)
setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🛡️ @${numero(user)} ғᴏɪ ʀᴇɢɪsᴛʀᴀᴅᴏ ᴄᴏᴍᴏ ᴅᴏɴᴏ ᴅᴏ ɢʀᴜᴘᴏ.*\n\n> Se algum admin rebaixar essa pessoa, eu devolvo o ADM dela e tiro o ADM de quem rebaixou.${botadm ? '' : '\n\n⚠️ Eu preciso ser admin do grupo para proteger.'}` }, { quote: selo, mentions: [user] })
}
break

//=============[ PING ]=============\\

case 'ping': {
const inicio = process.hrtime.bigint()
await Promise.resolve()

const latencia = Number(process.hrtime.bigint() - inicio) / 1e6
const atraso = (latencia / 1000).toFixed(4)

const up = Math.floor(process.uptime())
const dias = Math.floor(up / 86400)
const horas = Math.floor((up % 86400) / 3600)
const minutos = Math.floor((up % 3600) / 60)
const segundos = up % 60

const tempo = `${dias}d ${horas}h ${minutos}m ${segundos}s`

const total = (os.totalmem() / 1024 ** 3).toFixed(2)
const usada = ((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(2)

const cpu = os.loadavg()[0].toFixed(2)

await reply(`╭─ ͡┄┄───────ׅ─ׅ─ׅ──ׂ─ׅ──────⟡
╎⋆.°🏃‍♂️ • ᴠᴇʟᴏᴄɪᴅᴀᴅᴇ: *${latencia.toFixed(2)} ms*
╎⋆.°⚡ • ʟᴀᴛᴇ̂ɴᴄɪᴀ: *${latencia.toFixed(2)} ms*
╎⋆.°⌛ • ᴀᴛʀᴀsᴏ: *${atraso} s*
╎⋆.°🧠 • ʀᴀᴍ: *${usada} GB / ${total} GB*
╎⋆.°💻 • ᴄᴘᴜ ʟᴏᴀᴅ: *${cpu}%*
╎⋆.°🖥️ • ɴᴏᴅᴇ: *${process.version}*
╎⋆.°🕰️ • ᴜᴘᴛɪᴍᴇ: *${tempo}*
╰─͡┄┄───────ׂ─ׅ───ׂ─ׅ─ׅ──ׅ───⟡
> — *${NomeDoBot}*`)
}
break

//=============[ CRIADOR ]=============\\

case 'criador':
case 'dono':
case 'owner': {
const n = String(ownerNumber || '').replace(/\D/g, ''), donoNome = ownerName || 'Dylan Modz'
const vcard = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${donoNome}`, `N:${donoNome};;;;`, `TEL;type=CELL;type=VOICE;waid=${n}:+${n}`, 'END:VCARD'].join('\n')
await diablo.message.send(from, { contactMessage: { displayName: donoNome, vcard } }, { quote: selo })
}
break

//=============[ ADMINISTRAÇÃO ]=============\\

case 'ban':
case 'banir':
case 'kick':
case 'avadakedavra': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())

const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())

const user = alvo(membro, marc_tds || menc_os2)
await diablo.message.send(from, { type: 'text', text: `*@${numero(user)} ғᴏɪ ʀᴇᴍᴏᴠɪᴅᴏ ᴅᴏ ɢʀᴜᴘᴏ.*` }, { quote: selo, mentions: [user] })
await diablo.group.removeParticipants(from, [user])
}
break

case 'promover':
case 'promote': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(dataGp[0].donogp?.ids?.length && !dono && !ehDonoDoGrupo(dataGp[0].donogp, autor, sender, alt)) {
const quem = alvo(autor, sender) || sender
const removeu = botadm && !autor?.isSuperAdmin
if(removeu) await diablo.group.demoteParticipants(from, [quem]).catch(() => {})
return diablo.message.send(from, { type: 'text', text: `*🚫 @${numero(quem)} você não tem permissão para promover membros.*\n> Somente o dono do grupo (@${numero(dataGp[0].donogp.jid)}) pode usar este comando.${removeu ? '\n> Seu ADM foi removido.' : ''}` }, { quote: selo, mentions: [quem, dataGp[0].donogp.jid] })
}
if(!botadm) return reply(mess.onlyBotAdmin())
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())

const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())

const user = alvo(membro, marc_tds || menc_os2)
await diablo.group.promoteParticipants(from, [user])
await diablo.message.send(from, { type: 'text', text: `*@${numero(user)} ғᴏɪ ᴘʀᴏᴍᴏᴠɪᴅᴏ ᴄᴏᴍ sᴜᴄᴇssᴏ.*` }, { quote: selo, mentions: [user] })
}
break

case 'rebaixar':
case 'demote': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(dataGp[0].donogp?.ids?.length && !dono && !ehDonoDoGrupo(dataGp[0].donogp, autor, sender, alt)) {
const quem = alvo(autor, sender) || sender
const removeu = botadm && !autor?.isSuperAdmin
if(removeu) await diablo.group.demoteParticipants(from, [quem]).catch(() => {})
return diablo.message.send(from, { type: 'text', text: `*🚫 @${numero(quem)} você não tem permissão para rebaixar membros.*\n> Somente o dono do grupo (@${numero(dataGp[0].donogp.jid)}) pode usar este comando.${removeu ? '\n> Seu ADM foi removido.' : ''}` }, { quote: selo, mentions: [quem, dataGp[0].donogp.jid] })
}
if(!botadm) return reply(mess.onlyBotAdmin())
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())

const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())

const user = alvo(membro, marc_tds || menc_os2)
await diablo.group.demoteParticipants(from, [user])
await diablo.message.send(from, { type: 'text', text: `*@${numero(user)} ғᴏɪ ʀᴇʙᴀɪxᴀᴅᴏ ᴄᴏᴍ sᴜᴄᴇssᴏ.*` }, { quote: selo, mentions: [user] })
}
break

//=============[ ATIVAÇÕES ]=============\\

case 'bemvindo':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].wellcome[0].bemvindo1 = !dataGp[0].wellcome[0].bemvindo1
setGp(dataGp)
reply(dataGp[0].wellcome[0].bemvindo1 ? mess.ativo('ʙᴇᴍ-ᴠɪɴᴅᴏ') : mess.inativo('ʙᴇᴍ-ᴠɪɴᴅᴏ'))
break

case 'legendabv':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!isWelkom) return reply(`*ᴀᴛɪᴠᴇ ᴏ ${prefix}bemvindo.*`)
if(!q) return reply(`*ᴇxᴇᴍᴘʟᴏ: ${prefix}legendabv ᴏʟᴀ #numerodele#*`)
dataGp[0].wellcome[0].legendabv1 = q.trim() === '0' ? '0' : q
setGp(dataGp)
reply(q.trim() === '0' ? '*ʟᴇɢᴇɴᴅᴀ ᴅᴇ ᴇɴᴛʀᴀᴅᴀ ᴠᴏʟᴛᴏᴜ ᴘᴀʀᴀ ᴀ ᴘᴀᴅʀᴀᴏ.*' : '*ʟᴇɢᴇɴᴅᴀ ᴅᴇ ᴇɴᴛʀᴀᴅᴀ ᴀᴛᴜᴀʟɪᴢᴀᴅᴀ.*')
break

case 'legendasaiu':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!isWelkom) return reply(`*ᴀᴛɪᴠᴇ ᴏ ${prefix}bemvindo.*`)
if(!q) return reply(`*ᴇxᴇᴍᴘʟᴏ: ${prefix}legendasaiu ᴀᴛᴇ ʟᴏɢᴏ #numerodele#*`)
dataGp[0].wellcome[0].legendasaiu1 = q.trim() === '0' ? '0' : q
setGp(dataGp)
reply(q.trim() === '0' ? '*ʟᴇɢᴇɴᴅᴀ ᴅᴇ sᴀɪᴅᴀ ᴠᴏʟᴛᴏᴜ ᴘᴀʀᴀ ᴀ ᴘᴀᴅʀᴀᴏ.*' : '*ʟᴇɢᴇɴᴅᴀ ᴅᴇ sᴀɪᴅᴀ ᴀᴛᴜᴀʟɪᴢᴀᴅᴀ.*')
break

case 'fundobv': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
if(!isWelkom) return reply(`*ᴀᴛɪᴠᴇ ᴏ ${prefix}bemvindo.*`)

if(q.trim() === '0') {
dataGp[0].wellcome[0].fundobv = null
dataGp[0].wellcome[0].fundobv_tipo = null
setGp(dataGp)
return reply('*ғᴜɴᴅᴏ ᴅᴇ ᴇɴᴛʀᴀᴅᴀ ʀᴇᴍᴏᴠɪᴅᴏ. ᴀɢᴏʀᴀ ᴜsᴀ ᴀ ғᴏᴛᴏ ᴅᴏ ᴍᴇᴍʙʀᴏ.*')
}

const fonte = citado || m
const media = fonte?.viewOnceMessage?.message || fonte?.viewOnceMessageV2?.message || fonte
const videoMsg = media?.videoMessage
const imagemMsg = media?.imageMessage
if(!videoMsg && !imagemMsg) return reply('*ʀᴇsᴘᴏɴᴅᴀ ᴜᴍᴀ ғᴏᴛᴏ, ɢɪғ ᴏᴜ ᴠɪᴅᴇᴏ.*')

const tmp = path.join(__dirname, 'dados', 'media', `.bv-${Date.now()}`)
fs.mkdirSync(path.dirname(tmp), { recursive: true })
try {
await diablo.message.downloadToFile(media, tmp)
const buffer = fs.readFileSync(tmp)
dataGp[0].wellcome[0].fundobv = buffer.toString('base64')
dataGp[0].wellcome[0].fundobv_tipo = imagemMsg ? (String(imagemMsg?.mimetype || '').includes('png') ? 'png' : 'image') : 'gif'
setGp(dataGp)
reply(imagemMsg ? '*ғᴏᴛᴏ ᴅᴇ ᴇɴᴛʀᴀᴅᴀ sᴀʟᴠᴀ.*' : '*ɢɪғ/ᴠɪᴅᴇᴏ ᴅᴇ ᴇɴᴛʀᴀᴅᴀ sᴀʟᴠᴏ.*')
} finally { try { fs.unlinkSync(tmp) } catch {} }
}
break

case 'fundosaiu': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
if(!isWelkom) return reply(`*ᴀᴛɪᴠᴇ ᴏ ${prefix}bemvindo.*`)

if(q.trim() === '0') {
dataGp[0].wellcome[0].fundosaiu = null
dataGp[0].wellcome[0].fundosaiu_tipo = null
setGp(dataGp)
return reply('*ғᴜɴᴅᴏ ᴅᴇ sᴀɪᴅᴀ ʀᴇᴍᴏᴠɪᴅᴏ. ᴀɢᴏʀᴀ ᴜsᴀ ᴀ ғᴏᴛᴏ ᴅᴏ ᴍᴇᴍʙʀᴏ.*')
}

const fonte = citado || m
const media = fonte?.viewOnceMessage?.message || fonte?.viewOnceMessageV2?.message || fonte
const videoMsg = media?.videoMessage
const imagemMsg = media?.imageMessage
if(!videoMsg && !imagemMsg) return reply('*ʀᴇsᴘᴏɴᴅᴀ ᴜᴍᴀ ғᴏᴛᴏ, ɢɪғ ᴏᴜ ᴠɪᴅᴇᴏ.*')

const tmp = path.join(__dirname, 'dados', 'media', `.saiu-${Date.now()}`)
fs.mkdirSync(path.dirname(tmp), { recursive: true })
try {
await diablo.message.downloadToFile(media, tmp)
const buffer = fs.readFileSync(tmp)
dataGp[0].wellcome[0].fundosaiu = buffer.toString('base64')
dataGp[0].wellcome[0].fundosaiu_tipo = imagemMsg ? (String(imagemMsg?.mimetype || '').includes('png') ? 'png' : 'image') : 'gif'
setGp(dataGp)
reply(imagemMsg ? '*ғᴏᴛᴏ ᴅᴇ sᴀɪᴅᴀ sᴀʟᴠᴀ.*' : '*ɢɪғ/ᴠɪᴅᴇᴏ ᴅᴇ sᴀɪᴅᴀ sᴀʟᴠᴏ.*')
} finally { try { fs.unlinkSync(tmp) } catch {} }
}
break

case 'x9adm':
case 'x9':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].x9 = !dataGp[0].x9; setGp(dataGp)
reply(dataGp[0].x9 ? mess.ativo('x9 ᴀᴅᴍɪɴ') : mess.inativo('x9 ᴀᴅᴍɪɴ'))
break

case 'antiimg':
case 'antiimagem':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antiimg = !dataGp[0].antiimg; setGp(dataGp)
reply(dataGp[0].antiimg ? mess.ativo('ᴀɴᴛɪ ɪᴍᴀɢᴇᴍ') : mess.inativo('ᴀɴᴛɪ ɪᴍᴀɢᴇᴍ'))
break

case 'antivideo':
case 'antivid':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antivideo = !dataGp[0].antivideo; setGp(dataGp)
reply(dataGp[0].antivideo ? mess.ativo('ᴀɴᴛɪ ᴠɪᴅᴇᴏ') : mess.inativo('ᴀɴᴛɪ ᴠɪᴅᴇᴏ'))
break

case 'anticontato':
case 'anticontact':
case 'anticontatos':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].anticontato = !dataGp[0].anticontato; setGp(dataGp)
reply(dataGp[0].anticontato ? mess.ativo('ᴀɴᴛɪ ᴄᴏɴᴛᴀᴛᴏ') : mess.inativo('ᴀɴᴛɪ ᴄᴏɴᴛᴀᴛᴏ'))
break

case 'antiloc':
case 'antilocalizacao':
case 'antilocal':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antiloc = !dataGp[0].antiloc; setGp(dataGp)
reply(dataGp[0].antiloc ? mess.ativo('ᴀɴᴛɪ ʟᴏᴄᴀʟɪᴢᴀᴄᴀᴏ') : mess.inativo('ᴀɴᴛɪ ʟᴏᴄᴀʟɪᴢᴀᴄᴀᴏ'))
break

case 'gay':
case 'bv':
case 'lesbica':
case 'lula':
case 'ciumento':
case 'corno':
case 'vesgo':
case 'bebado':
case 'preguicoso':
case 'corajoso':
case 'feio':
case 'gostoso':
case 'gostosa':
case 'chato':
case 'chorao':
case 'perturbado':
case 'rico':
case 'pobre':
case 'gado':
{
if(!grupo) return reply(mess.onlyGroup())
const cfg = BRINCADEIRAS[command]
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
const user = (membro && alvo(membro, marc_tds || menc_os2)) || sender
const nome = `@${numero(user)}`

await diablo.message.send(from, { type: 'text', text: `❰ ${cfg.emoji} Pesquisando a sua ficha de ${cfg.label.toLowerCase()}: ${nome} aguarde... ❱` }, { quote: selo, mentions: [user] })
await new Promise(r => setTimeout(r, 2000))

const porcentagem = Math.floor(Math.random() * 101)
const frase = (cfg.frases.find(([min, max]) => porcentagem >= min && porcentagem <= max) || cfg.frases[cfg.frases.length - 1])[2]

const resultado = `╔═══❖•ೋ°${cfg.emoji}°ೋ•❖═══╗\n\n*O Quanto Você É ${cfg.label}?*\n\n${nome} Você é: ❰ ${porcentagem}% ❱ ${cfg.label} ${cfg.emoji}\n\n🧪 ${frase}\n\nHumm... Você não me engana 🤧\n╚═══❖•ೋ°${cfg.emoji}°ೋ•❖═══╝`

let foto = ''
try { foto = (await diablo.profile.getProfilePicture(user, 'image'))?.url || '' } catch {}
if(!foto) try { foto = (await diablo.profile.getProfilePicture(from, 'image'))?.url || '' } catch {}

if(foto) {
try {
const media = await baixar(foto)
return diablo.message.send(from, { type: 'image', media, mimetype: 'image/jpeg', caption: resultado }, { quote: selo, mentions: [user] })
} catch {}
}
return diablo.message.send(from, { type: 'text', text: resultado }, { quote: selo, mentions: [user] })
}
break

case 'antiaudio':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antiaudio = !dataGp[0].antiaudio; setGp(dataGp)
reply(dataGp[0].antiaudio ? mess.ativo('ᴀɴᴛɪ ᴀᴜᴅɪᴏ') : mess.inativo('ᴀɴᴛɪ ᴀᴜᴅɪᴏ'))
break

case 'rankgay':
case 'rankbv':
case 'ranklesbica':
case 'ranklula':
case 'rankciumento':
case 'rankcorno':
case 'rankvesgo':
case 'rankbebado':
case 'rankpreguicoso':
case 'rankcorajoso':
case 'rankfeio':
case 'rankgostoso':
case 'rankgostosa':
case 'rankchato':
case 'rankchorao':
case 'rankperturbado':
case 'rankrico':
case 'rankpobre':
case 'rankgado':
{
try {
    if(!grupo) return reply(mess.onlyGroup())

    // Identificar a brincadeira
    const tipo = command.replace(/^rank/, '')
    const cfg = BRINCADEIRAS[tipo]

    if(!cfg) return reply('❌ Ranking não encontrado!')

    // Verificar participantes
    if(!Array.isArray(groupMembers) || groupMembers.length < 5) {
        return reply('❌ Não foi possível encontrar participantes suficientes para o ranking.')
    }

    // Selecionar 5 participantes
    const participantes = groupMembers
    .map(m => typeof m === 'string' ? m : m.id || m.jid || m.participant)
    .filter(Boolean)

    const unicos = [...new Set(participantes)]

    if(unicos.length < 5) {
        return reply('❌ O grupo precisa ter pelo menos 5 participantes.')
    }

    await diablo.message.send(from, {
        type: 'text',
        text: `❰ ${cfg.emoji} Calculando o RANK ${cfg.label.toUpperCase()} do grupo... Aguarde! ❱`
    }, { quote: selo })

    await new Promise(r => setTimeout(r, 2000))

    // Gerar porcentagens
    const ranking = unicos
    .sort(() => Math.random() - 0.5)
    .slice(0, 5)
    .map(user => ({
        user,
        porcentagem: Math.floor(Math.random() * 101)
    }))
    .sort((a, b) => b.porcentagem - a.porcentagem)

    // Posições
    const medalhas = ['👑', '🥈', '🥉', '🏅', '🏅']

    const titulos = [
        'SUPREMO',
        'DE OURO',
        'BRILHANTE',
        'DE PRATA',
        'DE BRONZE'
    ]

    // Montar resultado
    const lista = ranking.map((r, i) => {
        const nome = `@${numero(r.user)}`

        return `${medalhas[i]} ${cfg.emoji} *${cfg.label.toUpperCase()} ${titulos[i]}*\n👤 ${nome}\n📊 ${r.porcentagem}% de ${cfg.label.toLowerCase()}`
    })

    const resultado = `🏆 *RANK ${cfg.label.toUpperCase()} 2025 - TOP 5* ${cfg.emoji}

${lista.join('\n➖➖➖➖➖➖➖➖➖\n')}

╭━━━❖
┃ 🏆 *RESULTADO FINAL*
┃ O primeiro colocado levou a coroa!
┃ Parabéns ao campeão! 🤣
╰━━━❖`

    const mentions = ranking.map(r => r.user)

    return await diablo.message.send(from, {
        type: 'text',
        text: resultado
    }, {
        quote: selo,
        mentions
    })

} catch (e) {
    console.error('ERRO NO RANK:', e)
    return reply('❌ Ocorreu um erro ao gerar o ranking. Verifique o terminal.')
}
}
break

case 'antiaudio':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antiaudio = !dataGp[0].antiaudio; setGp(dataGp)
reply(dataGp[0].antiaudio ? mess.ativo('ᴀɴᴛɪ ᴀᴜᴅɪᴏ') : mess.inativo('ᴀɴᴛɪ ᴀᴜᴅɪᴏ'))
break

case 'antisticker':
case 'antifigu':
case 'antifigurinha':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antisticker = !dataGp[0].antisticker; setGp(dataGp)
reply(dataGp[0].antisticker ? mess.ativo('ᴀɴᴛɪ ғɪɢᴜʀɪɴʜᴀ') : mess.inativo('ᴀɴᴛɪ ғɪɢᴜʀɪɴʜᴀ'))
break

case 'antilink':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antilink = !dataGp[0].antilink; setGp(dataGp)
reply(dataGp[0].antilink ? mess.ativo('ᴀɴᴛɪ ʟɪɴᴋ') : mess.inativo('ᴀɴᴛɪ ʟɪɴᴋ'))
break

case 'advlink':
case 'advertencialink':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
const adm = alvo(autor, sender) || sender
dataGp[0].advlink = !dataGp[0].advlink
if(dataGp[0].advlink) dataGp[0].antilink = false
setGp(dataGp)
const txt = dataGp[0].advlink
? `*Ativo com sucesso a Advertência por link neste grupo!! 🙅‍♀️*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _3/3 Advertências, o membro será banido caso envie links no grupo!!_ ⚠️`
: `*Desativado com sucesso a Advertência por link* 🙇‍♀️\n• _O antilink será desativado, para ligar novamente use: *${prefix}Antilink*_`
return diablo.message.send(from, { type: 'text', text: txt }, { quote: selo, mentions: [adm] })
}
break

case 'advlinkgp':
case 'advertencialinkgp':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
const adm = alvo(autor, sender) || sender
dataGp[0].advlinkgp = !dataGp[0].advlinkgp
if(dataGp[0].advlinkgp) dataGp[0].antilinkgp = false
setGp(dataGp)
const txt = dataGp[0].advlinkgp
? `*Ativo com sucesso a Advertência por link de grupo neste grupo!! 🙅‍♀️*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _3/3 Advertências, o membro será banido caso envie links de grupos aqui!!_ ⚠️`
: `*Desativado com sucesso a Advertência por link de grupo* 🙇‍♀️\n• _O antilinkgp será desativado, para ligar novamente use: *${prefix}Antilinkgp*_`
return diablo.message.send(from, { type: 'text', text: txt }, { quote: selo, mentions: [adm] })
}
break

case 'autosticker':
case 'autofigu':
case 'autofigurinha':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
dataGp[0].autosticker = !dataGp[0].autosticker; setGp(dataGp)
reply(dataGp[0].autosticker ? mess.ativo('ᴀᴜᴛᴏ sᴛɪᴄᴋᴇʀ') : mess.inativo('ᴀᴜᴛᴏ sᴛɪᴄᴋᴇʀ'))
break

case 'antiflood':
case 'antispam':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antiflood = !dataGp[0].antiflood; setGp(dataGp)
FLOOD.delete(from)
reply(dataGp[0].antiflood ? mess.ativo('ᴀɴᴛɪ ꜰʟᴏᴏᴅ') : mess.inativo('ᴀɴᴛɪ ꜰʟᴏᴏᴅ'))
break

case 'advflood':
case 'advertenciaflood':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
const adm = alvo(autor, sender) || sender
dataGp[0].advflood = !dataGp[0].advflood
if(dataGp[0].advflood) dataGp[0].antiflood = false
setGp(dataGp)
FLOOD.delete(from)
const txt = dataGp[0].advflood
? `*Ativo com sucesso a Advertência por flood neste grupo!! 🙅‍♀️*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _3/3 Advertências, o membro será banido caso mande mais de ${FLOOD_LIMITE} mensagens seguidas!!_ ⚠️`
: `*Desativado com sucesso a Advertência por flood* 🙇‍♀️\n• _O antiflood será desativado, para ligar novamente use: *${prefix}Antiflood*_`
return diablo.message.send(from, { type: 'text', text: txt }, { quote: selo, mentions: [adm] })
}
break

case 'antifake':
case 'antiestrangeiros':
case 'antiestrangeiro':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antifake = !dataGp[0].antifake; setGp(dataGp)
reply(dataGp[0].antifake
? `*ANTI-ESTRANGEIROS ATIVO COM SUCESSO NESTE GRUPO✨*`
: `*ANTI-ESTRANGEIROS DESATIVADO COM SUCESSO 🙇‍♀️*`)
break

case 'antinotas':
case 'antinota':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antinotas = !dataGp[0].antinotas; setGp(dataGp)
reply(dataGp[0].antinotas
? `*ANTI-NOTAS ATIVO COM SUCESSO🙅‍♀️*\n\n_Onde haver um *texto* que contenha *notas*, o usuário será *banido* ❗_`
: `*ANTI-NOTAS DESATIVADO COM SUCESSO 🙇‍♀️*`)
break

case 'antipalavra':
case 'antipalavrao':
case 'antipalavroes':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antipalavra = !dataGp[0].antipalavra; setGp(dataGp)
reply(dataGp[0].antipalavra
? `*ANTI-PALAVRÃO ATIVO COM SUCESSO!!🙅‍♀️*`
: `*ANTI-PALAVRÃO DESATIVADO COM SUCESSO!!🙇‍♀️*`)
break

case 'antidoc':
case 'antidocumento':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antidoc = !dataGp[0].antidoc; setGp(dataGp)
reply(dataGp[0].antidoc
? `*ANTI-DOCUMENTO🗳 ATIVO COM SUCESSO NO GRUPO✨*\n\nMeu lugar`
: `*ANTI-DOCUMENTO🗳 DESATIVADO COM SUCESSO 🙇‍♀️*`)
break

case 'anticatalogo':
case 'anticatalog':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].anticatalogo = !dataGp[0].anticatalogo; setGp(dataGp)
reply(dataGp[0].anticatalogo ? mess.ativo('ᴀɴᴛɪ ᴄᴀᴛᴀʟᴏɢᴏ') : mess.inativo('ᴀɴᴛɪ ᴄᴀᴛᴀʟᴏɢᴏ'))
break

case 'autoresposta':
case 'autoresponder':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
dataGp[0].autoresposta = !dataGp[0].autoresposta; setGp(dataGp)
reply(dataGp[0].autoresposta
? mess.ativo('ᴀᴜᴛᴏ ʀᴇsᴘᴏsᴛᴀ') + `\n\n_Veja as respostas com *${prefix}listaresposta* e crie as suas com *${prefix}addresposta*_`
: mess.inativo('ᴀᴜᴛᴏ ʀᴇsᴘᴏsᴛᴀ'))
break

case 'addresposta':
case 'addresp':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const [gat, ...resto] = q.split('|')
const gatilho = normGatilho(gat)
const resposta = resto.join('|').trim()
if(!gatilho || !resposta) return reply(`*Use:* ${prefix}addresposta gatilho | resposta\n\n*Exemplo:* ${prefix}addresposta bom dia | Bom dia, tudo bem? ☀️`)
if(gatilho.length > 40) return reply('*O gatilho pode ter no máximo 40 caracteres.*')
if(resposta.length > 1000) return reply('*A resposta pode ter no máximo 1000 caracteres.*')
dataGp[0].respostas = dataGp[0].respostas || {}
if(!(gatilho in dataGp[0].respostas) && Object.keys(dataGp[0].respostas).length >= 50) return reply('*Limite de 50 respostas por grupo atingido. Apague alguma com* ' + prefix + 'delresposta')
dataGp[0].respostas[gatilho] = resposta; setGp(dataGp)
reply(`*Resposta salva!* ✅\n\n*Gatilho:* ${gatilho}\n*Resposta:* ${resposta}` + (dataGp[0].autoresposta ? '' : `\n\n_A auto resposta está desligada. Ligue com *${prefix}autoresposta*_`))
}
break

case 'delresposta':
case 'delresp':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const gatilho = normGatilho(q)
if(!gatilho) return reply(`*Use:* ${prefix}delresposta gatilho`)
if(!dataGp[0].respostas || !(gatilho in dataGp[0].respostas)) return reply(gatilho in AUTORESP_PADRAO ? `*Essa resposta já vem pronta e não pode ser apagada.* Para trocar o texto, use ${prefix}addresposta ${gatilho} | nova resposta` : '*Não existe resposta com esse gatilho.* Veja a lista em ' + prefix + 'listaresposta')
delete dataGp[0].respostas[gatilho]; setGp(dataGp)
reply(`*Resposta removida:* ${gatilho} 🗑️`)
}
break

case 'listaresposta':
case 'respostas':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const lista = Object.entries({ ...AUTORESP_PADRAO, ...(dataGp[0].respostas || {}) })
reply(`*💬 AUTO RESPOSTAS (${lista.length})*\n\n` + lista.map(([g, r], i) => `${i + 1}. *${g}* ➜ ${r.length > 60 ? r.slice(0, 60) + '…' : r}`).join('\n') + `\n\n_Crie as suas com *${prefix}addresposta gatilho | resposta*_`)
}
break

case 'status':
case 'statusgp':
case 'statusgrupo':
if(!grupo) return reply(mess.onlyGroup())
{
const gp = dataGp[0]
const bv = gp.wellcome?.[0] || {}
const itens = [
['BEM-VINDO', bv.bemvindo1],
['ANTI-LINK', gp.antilink],
['ADV-LINK', gp.advlink],
['ANTI-LINKGP', gp.antilinkgp],
['ADV-LINKGP', gp.advlinkgp],
['ANTI-BOT', gp.antibot],
['ANTI-FAKE', gp.antifake],
['ANTI-IMAGEM', gp.antiimg],
['ANTI-VIDEO', gp.antivideo],
['ANTI-AUDIO', gp.antiaudio],
['ANTI-STICKER', gp.antisticker],
['ANTI-DOCUMENTO', gp.antidoc],
['ANTI-LOC', gp.antiloc],
['ANTI-CONTATO', gp.anticontato],
['ANTI-CATALOGO', gp.anticatalogo],
['ANTI-NOTAS', gp.antinotas],
['ANTI-PALAVRA', gp.antipalavra],
['ANTI-MARCAR', gp.antimarcar],
['ANTI-FLOOD', gp.antiflood],
['ADV-FLOOD', gp.advflood],
['ANTI-PAGAMENTO', gp.antipayment],
['AUTO-FIGURINHA', gp.autosticker],
['AUTO-RESPOSTA', gp.autoresposta],
['SO-ADM', gp.soadm],
['X9-ADM', gp.x9]
]
const linhas = itens.map(([nome, ligado]) => `│╎𖤛 ${nome}⧽ ${ligado === true ? '✅' : '❌'}`).join('\n')
reply(`╭━✰°❀•°✮•| ⊱✿⊰ |•°•❀°✾✰━╮
┣⋆⃟ۣۜ᭪➮ 𖡦 𝐒𝐓𝐀𝐓𝐔𝐒 𝐃𝐎 𝐆𝐑𝐔𝐏𝐎 ✨ 
╰━✰°❀•°✮•| ⊱✿⊰ |•°•❀°✾✰━╯
│╭━━───────━━╮ 
${linhas}
╰━━━✰°❀•°✮°•❀°✾✰━━━╯`)
}
break

case 'opengp':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
dataGp[0].opengp = dataGp[0].opengp || { ativo: false, abrirEm: null, duracao: null, legenda: null }
const og = dataGp[0].opengp
const arg = String(q || '').trim()
const argN = normGatilho(arg)
const feitos = []

if(argN === 'media off') {
const removeu = removerMediaOpenGp(from)
return reply(removeu ? '*🗑️ Mídia removida! A abertura será enviada sem imagem/vídeo.*' : '*Não há mídia salva para este grupo.*')
}

if(argN === 'testar') {
const r = await executarOpenGp(diablo, from, og)
return reply(r.ok ? '*✅ Teste feito! O grupo foi aberto.*' : `*❌ Não consegui abrir o grupo.*\n\n_Confirme se o bot é admin. Métodos encontrados na biblioteca (diablo.group): ${r.disponiveis.join(', ') || 'nenhum'}_`)
}

// mídia: imagem/vídeo marcado (resposta) ou enviado junto com o comando
const fonteMidia = [citado, m].map(f => f?.viewOnceMessage?.message || f?.viewOnceMessageV2?.message || f).find(f => f?.videoMessage || f?.imageMessage)
if(fonteMidia) {
const ehVideo = !!fonteMidia.videoMessage
const ext = ehVideo ? 'mp4' : (String(fonteMidia.imageMessage?.mimetype || '').toLowerCase().includes('png') ? 'png' : 'jpg')
fs.mkdirSync(path.join(__dirname, 'dados', 'media'), { recursive: true })
await reagir('⏳').catch(() => {})
removerMediaOpenGp(from)
await diablo.message.downloadToFile(fonteMidia, `${baseMediaOpenGp(from)}.${ext}`)
await reagir('✅').catch(() => {})
feitos.push(ehVideo ? '🎥 Vídeo salvo para a abertura!' : '🖼️ Imagem salva para a abertura!')
}

const mHora = arg.match(/^(\d{1,3})[.:](\d{2})$/)
if(mHora) {
const h = Number(mHora[1]), mi = Number(mHora[2])
if(mi > 59) return reply('*Minutos inválidos.* Use de 00 a 59. Exemplo: ' + prefix + 'opengp 05.00')
const duracao = (h * 60 + mi) * 60000
if(duracao <= 0) return reply('*Informe um tempo maior que zero.* Exemplo: ' + prefix + 'opengp 05.00')
if(duracao > OPENGP_MAX_HORAS * 3600000) return reply(`*O tempo máximo é ${OPENGP_MAX_HORAS} horas (7 dias).*`)
og.duracao = duracao
og.abrirEm = Date.now() + duracao
og.ativo = true
feitos.push(`⏰ O grupo vai abrir daqui *${fmtDurOpenGp(duracao)}* (${fmtQuandoOpenGp(og.abrirEm)})!`)
} else if(argN === 'desativar') {
og.ativo = false
og.abrirEm = null
feitos.push('🔕 Abertura automática *cancelada*.')
} else if(argN === 'ativar') {
if(!og.duracao) return reply(`*Defina primeiro um tempo.* Exemplo: ${prefix}opengp 05.00`)
og.ativo = true
og.abrirEm = Date.now() + og.duracao
feitos.push(`🔔 Abertura automática *ativada*: o grupo vai abrir daqui *${fmtDurOpenGp(og.duracao)}* (${fmtQuandoOpenGp(og.abrirEm)})!`)
} else if(arg) {
if(arg === '0') { og.legenda = '0'; feitos.push('📝 Legenda *desativada*.') }
else { og.legenda = arg; feitos.push('📝 Legenda definida!') }
}

if(!feitos.length) return reply(`• ✨️ *MODO DE USO* ✨️

- Defina daqui a quanto tempo o grupo vai abrir ⏰️ (horas.minutos)
- Exemplo: *${prefix}opengp* 05.00 _(abre daqui 5 horas)_
- Exemplo: *${prefix}opengp* 01.30 _(abre daqui 1 hora e 30 minutos)_
- Exemplo: *${prefix}opengp* 00.45 _(abre daqui 45 minutos)_

-
> -> Caso queira *Desativar* (cancelar) ou *Ativar* (reiniciar a contagem) a abertura automática do grupo, use: *${prefix}opengp* _Desativar ou Ativar_
-
> -> Para setar uma legenda, use *${prefix}opengp* _sua legenda_
> -> Adicione o número zero na legenda para desativa-la
-
> -> Mencione um vídeo ou uma imagem para que seja enviado (não é obrigatório)
-
> -> Envie *${prefix}opengp media off* (para remover a mídia)`)

setGp(dataGp)
reply(feitos.join('\n') + `\n\n*Abre:* ${og.ativo && og.abrirEm ? `daqui ${fmtDurOpenGp(og.abrirEm - Date.now())} (${fmtQuandoOpenGp(og.abrirEm)})` : 'não agendado'}\n*Estado:* ${og.ativo ? 'ativado ✅' : 'desativado ❌'}\n*Legenda:* ${og.legenda === '0' ? 'desativada' : (og.legenda ? 'personalizada' : 'padrão')}\n*Mídia:* ${acharMediaOpenGp(from) ? 'definida' : 'nenhuma'}` + (botadm ? '' : '\n\n_⚠️ Preciso ser admin do grupo para conseguir abrir._'))
}
break

case 'adverter':
case 'advertir':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
const user = alvo(membro, marc_tds || menc_os2)
const adm = alvo(autor, sender) || sender
if(membro.isAdmin || membro.isSuperAdmin) return reply('*Não é possível advertir um administrador.*')
if(numero(user) === numero(botNumber)) return reply('*Não posso advertir a mim mesmo.* 😅')
dataGp[0].advertencias = dataGp[0].advertencias || {}
const chave = numero(user)
const total = (dataGp[0].advertencias[chave] || 0) + 1
if(total >= 3) {
delete dataGp[0].advertencias[chave]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🚫 @${chave} atingiu 3/3 advertências e foi banido!*\n*[ Ação do adm ] - ( @${numero(adm)} )*` }, { quote: selo, mentions: [user, adm] })
await diablo.group.removeParticipants(from, [user])
} else {
dataGp[0].advertencias[chave] = total; (dataGp[0].advJids = dataGp[0].advJids || {})[chave] = user; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*⚠️ @${chave} recebeu uma advertência!*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _Advertências: ${total}/3, ao chegar em 3/3 o membro será banido._` }, { quote: selo, mentions: [user, adm] })
}
}
break

case 'rm_adv':
case 'rmadv':
case 'removeradv':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
const user = alvo(membro, marc_tds || menc_os2)
const adm = alvo(autor, sender) || sender
const chave = numero(user)
const atual = dataGp[0].advertencias?.[chave] || 0
if(!atual) return diablo.message.send(from, { type: 'text', text: `*@${chave} não tem nenhuma advertência.*` }, { quote: selo, mentions: [user] })
if(atual <= 1) delete dataGp[0].advertencias[chave]
else dataGp[0].advertencias[chave] = atual - 1
setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*✅ Uma advertência de @${chave} foi removida!*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _Advertências: ${atual - 1}/3_` }, { quote: selo, mentions: [user, adm] })
}
break

case 'lista_adv':
case 'listaadv':
case 'listaadvertencias':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const lista = Object.entries(dataGp[0].advertencias || {}).filter(([, n]) => n > 0)
if(!lista.length) return reply('*Nenhum membro tem advertência neste grupo.* ✨')
const jids = lista.map(([chave]) => dataGp[0].advJids?.[chave] || chave + '@s.whatsapp.net')
const texto = `*⚠️ LISTA DE ADVERTÊNCIAS (${lista.length})*\n\n` + lista.map(([chave, n], i) => `${i + 1}. @${chave} ➜ *${n}/3*`).join('\n')
await diablo.message.send(from, { type: 'text', text: texto }, { quote: selo, mentions: jids })
}
break

case 'ver_adv':
case 'veradv':
if(!grupo) return reply(mess.onlyGroup())
{
const alvoOutro = !!menc_os2 || busca.length > 6
if(alvoOutro && !admin && !dono) return reply(mess.onlyAdmins())
if(menc_jid2[1]) return reply(mess.semMencao())
const membro = alvoOutro ? achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2) : autor
if(!membro) return reply(mess.naoEncontrado())
const user = alvoOutro ? alvo(membro, marc_tds || menc_os2) : (alvo(autor, sender) || sender)
const chave = numero(user)
const atual = dataGp[0].advertencias?.[chave] || 0
await diablo.message.send(from, { type: 'text', text: `*⚠️ ADVERTÊNCIAS DE @${chave}*\n\n• _${atual}/3_ ${atual ? '⚠️' : '✅'}` }, { quote: selo, mentions: [user] })
}
break

case 'limpar_adv':
case 'limparadv':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const adm = alvo(autor, sender) || sender
if(!!menc_os2 || busca.length > 6) {
if(menc_jid2[1]) return reply(mess.semMencao())
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
const user = alvo(membro, marc_tds || menc_os2)
if(dataGp[0].advertencias) delete dataGp[0].advertencias[numero(user)]
setGp(dataGp)
return diablo.message.send(from, { type: 'text', text: `*🧹 As advertências de @${numero(user)} foram limpas!*\n*[ Ação do adm ] - ( @${numero(adm)} )*` }, { quote: selo, mentions: [user, adm] })
}
const quantos = Object.keys(dataGp[0].advertencias || {}).length
dataGp[0].advertencias = {}; dataGp[0].advJids = {}; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🧹 Todas as advertências do grupo foram limpas!* (${quantos} ${quantos === 1 ? 'membro' : 'membros'})\n*[ Ação do adm ] - ( @${numero(adm)} )*` }, { quote: selo, mentions: [adm] })
}
break

case 'aceitar':
case 'aceitarsolicitacoes':
case 'aceitarsolicitacao':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
await reagir('⏳').catch(() => {})
const r = await aceitarSolicitacoesApi(diablo, from)
if(r.ok && r.vazio) return reply('*Nenhuma solicitação pendente neste grupo.* ✨')
if(r.ok) {
console.log('[ACEITAR] solicitações aceitas via', r.via, '|', from)
await reagir('✅').catch(() => {})
return reply(`*✅ ${r.aceitos} ${r.aceitos === 1 ? 'solicitação aceita' : 'solicitações aceitas'}!*`)
}
console.log('[ACEITAR] não consegui | motivo:', r.motivo, '| erros:', r.erros, '| métodos em diablo.group:', r.nomes)
await reagir('❌').catch(() => {})
return reply(`*❌ Não consegui ${r.motivo === 'listar' ? 'listar' : 'aceitar'} as solicitações.*\n\n_Confirme se o grupo exige aprovação para entrar e se eu sou admin. Métodos da biblioteca ligados a solicitações: ${r.relacionados?.join(', ') || 'nenhum encontrado'}_`)
}
break

case 'ausente':
case 'afk':
if(!grupo) return reply(mess.onlyGroup())
{
const user = alvo(autor, sender) || sender
const motivo = String(q || '').trim().slice(0, 200) || 'Sem motivo especificado'
dataGp[0].ausentes = dataGp[0].ausentes || {}
dataGp[0].ausentes[numero(user)] = { motivo, desde: Date.now() }
setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*💤 @${numero(user)} está ausente!*\n*💬 Motivo: ${motivo}*\n\n_Quando voltar, é só mandar uma mensagem ou usar *${prefix}ativo*._` }, { quote: selo, mentions: [user] })
}
break

case 'ativo':
if(!grupo) return reply(mess.onlyGroup())
{
const user = alvo(autor, sender) || sender
const aus = dataGp[0].ausentes?.[numero(user)]
if(!aus) return reply(`*Você não estava ausente.* Para ficar ausente, use *${prefix}ausente* _motivo_`)
delete dataGp[0].ausentes[numero(user)]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: textoVoltou(numero(user), aus) }, { quote: selo, mentions: [user] })
}
break

case 'banghost':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
const partes = String(q || '').trim().split(/\s+/).filter(Boolean)
if(!partes.length || !/^\d+$/.test(partes[0])) return reply(`*👻 BANGHOST*\n\n➭ Digite a partir de quantas mensagens você deseja remover _(quem não interage no grupo)_.\nExemplo: *${prefix}banghost 0* ❀`)
const limite = Number(partes[0])
const confirmou = partes.slice(1).some(p => p.toLowerCase() === 'confirmar')
const c = contagemGrupo(from)
const donoNr = String(ownerNumber || '').replace(/\D/g, '')
const candidatos = []
for(const m of groupMembers) {
if(m?.isAdmin || m?.isSuperAdmin) continue
const jid = alvo(m, m?.jid || m?.phoneJid || m?.pnJid || m?.id || m?.lidJid || '')
if(!jid) continue
const chave = numero(jid)
if(chave === numero(botNumber) || (donoNr && chave === donoNr)) continue
if((c.msgs[chave] || 0) <= limite) candidatos.push(jid)
}
if(!candidatos.length) return reply(`*Não tem mais pessoas com ${limite} mensagem(ns) para eu remover..*`)
const dias = (Date.now() - c.desde) / 86400000
const desde = new Date(c.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
if(dias < 3 && !confirmou) return reply(`*⚠️ Atenção!*\n\nComecei a contar as mensagens deste grupo em *${desde}*. Quem falou antes disso aparece com 0 mensagens e seria removido por engano.\n\n• _Seriam removidos *${candidatos.length}* ${candidatos.length === 1 ? 'membro' : 'membros'}._\n\nPara executar mesmo assim, use: *${prefix}banghost ${limite} confirmar*`)
const adm = alvo(autor, sender) || sender
for(let i = 0; i < candidatos.length; i += 10) {
await diablo.group.removeParticipants(from, candidatos.slice(i, i + 10)).catch(() => {})
if(i + 10 < candidatos.length) await new Promise(r => setTimeout(r, 1500))
}
await diablo.message.send(from, { type: 'text', text: `*👻 BANGHOST*\n\n• ${candidatos.length} ${candidatos.length === 1 ? 'membro removido' : 'membros removidos'} _(${limite} mensagem(ns) ou menos)_\n• _Contagem desde ${desde}_\n*[ Ação do adm ] - ( @${numero(adm)} )*` }, { quote: selo, mentions: [adm] })
}
break

case 'mute':
case 'mutar':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
{
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
const user = alvo(membro, marc_tds || menc_os2)
const adm = alvo(autor, sender) || sender
if(membro.isAdmin || membro.isSuperAdmin) return reply('*Não é possível mutar um administrador.*')
if(numero(user) === numero(botNumber)) return reply('*Não posso mutar a mim mesmo.* 😅')
dataGp[0].mutados = dataGp[0].mutados || {}
if(dataGp[0].mutados[numero(user)]) return diablo.message.send(from, { type: 'text', text: `*@${numero(user)} já está mutado.* 🔇` }, { quote: selo, mentions: [user] })
dataGp[0].mutados[numero(user)] = { desde: Date.now() }; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🔇 @${numero(user)} foi mutado!*\n*[ Ação do adm ] - ( @${numero(adm)} )*\n\n• _As mensagens dele serão apagadas até ser desmutado com *${prefix}desmute*._` }, { quote: selo, mentions: [user, adm] })
}
break

case 'desmute':
case 'desmutar':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
if((!menc_os2 && busca.length <= 6) || menc_jid2[1]) return reply(mess.semMencao())
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(!membro) return reply(mess.naoEncontrado())
const user = alvo(membro, marc_tds || menc_os2)
const adm = alvo(autor, sender) || sender
if(!dataGp[0].mutados?.[numero(user)]) return diablo.message.send(from, { type: 'text', text: `*@${numero(user)} não está mutado.*` }, { quote: selo, mentions: [user] })
delete dataGp[0].mutados[numero(user)]; setGp(dataGp)
await diablo.message.send(from, { type: 'text', text: `*🔊 @${numero(user)} foi desmutado!*\n*[ Ação do adm ] - ( @${numero(adm)} )*` }, { quote: selo, mentions: [user, adm] })
}
break

case 'add_palavra':
case 'addpalavra':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const palavra = normGatilho(q)
if(!palavra) return reply(`*Use:* ${prefix}add_palavra palavrão\n\n*Exemplo:* ${prefix}add_palavra idiota`)
if(palavra.length < 2 || palavra.length > 40) return reply('*A palavra precisa ter entre 2 e 40 caracteres.*')
dataGp[0].palavroes = dataGp[0].palavroes || []
if(dataGp[0].palavroes.includes(palavra)) return reply(`*A palavra* _${palavra}_ *já está na lista do grupo.*`)
if(temPalavrao(palavra)) return reply(`*A palavra* _${palavra}_ *já é bloqueada pela lista padrão do bot.*`)
if(dataGp[0].palavroes.length >= 100) return reply(`*Limite de 100 palavras por grupo atingido.* Remova alguma com ${prefix}rm_palavra`)
dataGp[0].palavroes.push(palavra); setGp(dataGp)
reply(`*✅ Palavra adicionada ao anti-palavrão:* _${palavra}_` + (dataGp[0].antipalavra ? '' : `\n\n_O anti-palavrão está desligado neste grupo. Ligue com *${prefix}antipalavra*_`))
}
break

case 'rm_palavra':
case 'rmpalavra':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const palavra = normGatilho(q)
if(!palavra) return reply(`*Use:* ${prefix}rm_palavra palavrão`)
const lista = dataGp[0].palavroes || []
if(!lista.includes(palavra)) return reply(temPalavrao(palavra) ? `*A palavra* _${palavra}_ *faz parte da lista padrão do bot e não pode ser removida.*` : `*A palavra* _${palavra}_ *não está na lista do grupo.* Veja a lista em ${prefix}lista_palavra`)
dataGp[0].palavroes = lista.filter(p => p !== palavra); setGp(dataGp)
reply(`*🗑️ Palavra removida do anti-palavrão:* _${palavra}_`)
}
break

case 'lista_palavra':
case 'lista_palavras':
case 'listapalavra':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const lista = dataGp[0].palavroes || []
if(!lista.length) return reply(`*Nenhuma palavra extra neste grupo.* Use ${prefix}add_palavra palavrão\n\n_A lista padrão do bot continua valendo._`)
reply(`*🚫 PALAVRAS EXTRAS DO GRUPO (${lista.length})*\n\n` + lista.map((p, i) => `${i + 1}. ${p}`).join('\n') + '\n\n_Além da lista padrão do bot._')
}
break

case 'listanegra':
case 'autoban':
case 'addlistanegra':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
if(menc_jid2[1]) return reply(mess.semMencao())
const donoNr = String(ownerNumber || '').replace(/\D/g, '')
let numeroAlvo = ''
if(menc_os2) {
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
if(membro && (membro.isAdmin || membro.isSuperAdmin)) return reply('*Não é possível colocar um administrador na lista negra.*')
numeroAlvo = telefoneReal(membro, menc_os2) || numero(menc_os2)
} else {
numeroAlvo = String(q || '').replace(/\D/g, '')
if(numeroAlvo.length < 8 || numeroAlvo.length > 15) return reply(`*Use:* ${prefix}listanegra 5568999999999\n_ou marque / responda a pessoa._`)
}
if(naListaNegra([numero(botNumber), donoNr], numeroAlvo)) return reply('*Esse número não pode ser adicionado à lista negra.*')
dataGp[0].listanegra = dataGp[0].listanegra || []
if(naListaNegra(dataGp[0].listanegra, numeroAlvo)) return reply(`*Esse número já está na lista de autoban:* ${numeroAlvo}`)
if(dataGp[0].listanegra.length >= 200) return reply(`*Limite de 200 números atingido.* Remova algum com ${prefix}tirardalista`)
dataGp[0].listanegra.push(numeroAlvo); setGp(dataGp)
reply(`*Número adicionado a lista de autoban* 🙅‍♂️\n> Caso essa pessoa pise aqui, irei imediatamente bani-lo do grupo!! 🗡️`)
}
break

case 'tirardalista':
case 'tirarlista':
case 'rmlistanegra':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
if(menc_jid2[1]) return reply(mess.semMencao())
let numeroAlvo = ''
if(menc_os2) {
const membro = achar(groupMembers, marc_tds, mrc_ou_numero, menc_os2)
numeroAlvo = telefoneReal(membro, menc_os2) || numero(menc_os2)
} else {
numeroAlvo = String(q || '').replace(/\D/g, '')
if(numeroAlvo.length < 8 || numeroAlvo.length > 15) return reply(`*Use:* ${prefix}tirardalista 5568999999999\n_ou marque / responda a pessoa._`)
}
const antes = dataGp[0].listanegra || []
if(!naListaNegra(antes, numeroAlvo)) return reply('*Esse número não está na lista de autoban.*')
dataGp[0].listanegra = antes.filter(n => !naListaNegra([n], numeroAlvo)); setGp(dataGp)
reply('*Número removido da lista de autoban* ✅')
}
break

case 'listaban':
case 'listanegras':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const lista = dataGp[0].listanegra || []
if(!lista.length) return reply('*Nenhum Número adicionado*')
reply(`*Números que vou moer na porrada se voltar* 😡:\n\n` + lista.map(n => `➤ ${n}`).join('\n') + `\n\n*Esses ai vou descer meu martelo do ban* 🤬`)
}
break

case 'listafake':
case 'listaestrangeiros':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
const estrangeiros = []
let semNumero = 0
for(const m of groupMembers) {
const jid = alvo(m, m?.jid || m?.phoneJid || m?.pnJid || m?.id || m?.lidJid || '')
const tel = telefoneReal(m, jid)
if(!tel) { semNumero++; continue }
if(tel.startsWith('55') || tel === numero(botNumber)) continue
estrangeiros.push({ tel, jid })
}
if(!estrangeiros.length) return reply('*Nenhum Número Estrangeiro detectado!*' + (semNumero ? `\n\n_${semNumero} ${semNumero === 1 ? 'membro está' : 'membros estão'} com o número oculto pelo WhatsApp e não ${semNumero === 1 ? 'pôde' : 'puderam'} ser verificado${semNumero === 1 ? '' : 's'}._` : ''))
await diablo.message.send(from, { type: 'text', text: `*🌎 Números estrangeiros no grupo (${estrangeiros.length}):*\n\n` + estrangeiros.map(e => `➤ @${e.tel}`).join('\n') + `\n\n_Para banir todos de uma vez, ligue o *${prefix}antifake*._` + (semNumero ? `\n_${semNumero} ${semNumero === 1 ? 'membro está' : 'membros estão'} com o número oculto e não ${semNumero === 1 ? 'foi verificado' : 'foram verificados'}._` : '') }, { quote: selo, mentions: estrangeiros.map(e => e.jid).filter(Boolean) })
}
break

case 'atividades':
case 'atividade':
case 'topativos':
if(!grupo) return reply(mess.onlyGroup())
{
const c = contagemGrupo(from)
const msgsPor = c.msgs || {}, cmdsPor = c.cmds || {}
const botNr = numero(botNumber)
const vistos = new Map()
for(const m of groupMembers || []) {
const jid = alvo(m, m?.jid || m?.phoneJid || m?.pnJid || m?.id || m?.lidJid || '')
if(!jid) continue
const chave = numero(jid)
if(chave === botNr || vistos.has(chave)) continue
vistos.set(chave, { jid, chave, msgs: msgsPor[chave] || 0, cmds: cmdsPor[chave] || 0 })
}
const ranking = [...vistos.values()].filter(x => x.msgs > 0 || x.cmds > 0).sort((a, b) => b.msgs - a.msgs || b.cmds - a.cmds).slice(0, 10)
if(!ranking.length) return reply('*Ainda não tenho dados de atividade neste grupo.* Conforme as pessoas conversarem, o ranking aparece aqui. ✨')
const desde = new Date(c.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const texto = '*Atividade dos membros do grupo:*\n\n' + ranking.map(x => `░⃟⃛ ➮ *Participante*: @${x.chave}\n❒᭄꥓〭 *Comandos usados*: ${x.cmds}\n❒᭄꥓〭 *Mensagens enviadas*: ${x.msgs}`).join('\n\n') + `\n\n_Contagem desde ${desde}_`
await diablo.message.send(from, { type: 'text', text: texto }, { quote: selo, mentions: ranking.map(x => x.jid) })
}
break

case 'antilinkgp':
case 'antilinkgrupo':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antilinkgp = !dataGp[0].antilinkgp; setGp(dataGp)
reply(dataGp[0].antilinkgp ? mess.ativo('ᴀɴᴛɪ ʟɪɴᴋ ɢʀᴜᴘᴏ') : mess.inativo('ᴀɴᴛɪ ʟɪɴᴋ ɢʀᴜᴘᴏ'))
break

case 'antipayment':
case 'antipagamento':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antipayment = !dataGp[0].antipayment; setGp(dataGp)
reply(dataGp[0].antipayment ? mess.ativo('ᴀɴᴛɪ ᴘᴀʏᴍᴇɴᴛ') : mess.inativo('ᴀɴᴛɪ ᴘᴀʏᴍᴇɴᴛ'))
break

case 'antibot':
case 'antibots':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antibot = !dataGp[0].antibot; setGp(dataGp)
reply(dataGp[0].antibot
? `*ANTI-BOTS ATIVO COM SUCESSO NESTE GRUPO: 🙅‍♀️*\nMeu lugar\n\n> • Agora qualquer outro bot que interagir neste grupo, será banido!`
: `*ANTI-BOT DESATIVADO COM SUCESSO 🙇‍♀️*`)
break

case 'antimarcar':
case 'antimarcartodos':
case 'antitodos':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
dataGp[0].antimarcar = !dataGp[0].antimarcar; setGp(dataGp)
reply(dataGp[0].antimarcar
? `*⚠️ ANTI-MARCAR TODOS ATIVO COM SUCESSO NO GRUPO:* ✨\n↳ Meu lugar\n\n> • Caso um membro marque todos do grupo com mais de 10 participantes, ele será imediatamente banido! ❗`
: `❗ *ANTI-MARCAR DESATIVADO COM SUCESSO* 🙇‍♀️`)
break

case 'soadm':
case 'soadmin':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
dataGp[0].soadm = !dataGp[0].soadm; setGp(dataGp)
reply(dataGp[0].soadm ? mess.ativo('sᴏ ᴀᴅᴍ') : mess.inativo('sᴏ ᴀᴅᴍ'))
break

case 'sh_num':
case 'shnum':
case 'buscar_num':
case 'buscar_numero': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!q) return reply(`*Digite corretamente o comando!*\n\n*Exemplo:* ${prefix}sh_num 5568\n\n_55 é o código do país e 68 é o DDD._`)

const prefixo = q.trim().replace(/\D/g, '')
if(!prefixo) return reply('*Digite um código numérico válido.*')
if(!Array.isArray(groupMembers) || !groupMembers.length) return reply('*Não foi possível obter os participantes deste grupo.*')

const encontrados = []

for(const membro of groupMembers) {
const jid = typeof membro === 'string' ? membro : membro?.jid || membro?.phoneJid || membro?.pnJid || membro?.lidJid || membro?.id || ''
const telefone = telefoneReal(membro, jid)
if(!telefone || !telefone.startsWith(prefixo)) continue
const usuario = alvo(membro, jid) || jid
encontrados.push({ telefone, usuario })
}

if(!encontrados.length) return reply(`*Nenhum número começando com ${prefixo} foi encontrado neste grupo...✨*`)

const lista = encontrados.map((m, i) => `${i + 1}. @${m.telefone}`).join('\n')
const texto = `╭━━━❖
┃ 🔎 *BUSCA DE NÚMEROS*
╰━━━❖

❗ *Números que começam com:* ${prefixo}

📊 *Total encontrado:* ${encontrados.length}

${lista}

╭━━━❖
┃ ${NomeDoBot}
╰━━━❖`

return diablo.message.send(from, { type: 'text', text: texto }, { quote: selo, mentions: encontrados.map(m => m.usuario) })
}
break

case 'linkgp':
case 'linkgrupo':
case 'linkgroup':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())
try {
    const codigo = await diablo.group.queryInviteCode(from)
    if(!codigo) return reply('*Não foi possível obter o link do grupo.*')
    const link = `https://chat.whatsapp.com/${codigo}`
    return reply(`*Aqui esta o link do grupo🙇‍♀️💖*\n\n${link}`)
} catch (e) {
    console.error('[LINKGP] Erro ao obter link:', e)
    return reply('*Não foi possível obter o link do grupo. Verifique se o bot é administrador.*')
}
break

case 'totag':
case 'cita':
case 'marcar_todos':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const participantes = metadata.participants || []
    const mentions = participantes.map(p => p.jid).filter(Boolean)
    if(!mentions.length) return reply('❌ Não foi possível obter os participantes do grupo.')
    const mensagem = q || '\u200B'

    if(!citado) {
        await diablo.message.send(from, { type: 'text', text: mensagem }, { quote: selo, mentions })
    } else {
        // abre mensagem de visualização única, se for o caso
        const media = citado.viewOnceMessage?.message || citado.viewOnceMessageV2?.message || citado.viewOnceMessageV2Extension?.message || citado
        const img = media.imageMessage, vid = media.videoMessage, aud = media.audioMessage
        const fig = media.stickerMessage, doc = media.documentMessage || media.documentWithCaptionMessage?.message?.documentMessage
        const textoCitado = media.conversation || media.extendedTextMessage?.text || ''

        if(textoCitado && !img && !vid && !aud && !fig && !doc) {
            await diablo.message.send(from, { type: 'text', text: textoCitado }, { quote: selo, mentions })
        } else if(media.contactMessage || media.contactsArrayMessage || media.locationMessage) {
            // contato e localização são reenviados do jeito que vieram
            const bruto = media.contactMessage ? { contactMessage: media.contactMessage } : media.contactsArrayMessage ? { contactsArrayMessage: media.contactsArrayMessage } : { locationMessage: media.locationMessage }
            await diablo.message.send(from, bruto, { quote: selo, mentions })
        } else if(img || vid || aud || fig || doc) {
            const tmp = path.join(__dirname, 'dados', 'media', `.tag-${Date.now()}`)
            fs.mkdirSync(path.dirname(tmp), { recursive: true })
            try {
                await diablo.message.downloadToFile(media.documentWithCaptionMessage?.message || media, tmp)
                const dados = fs.readFileSync(tmp)
                const legenda = q || img?.caption || vid?.caption || doc?.caption || ''
                if(img) await diablo.message.send(from, { type: 'image', media: dados, mimetype: img.mimetype || 'image/jpeg', caption: legenda }, { quote: selo, mentions })
                else if(vid) await diablo.message.send(from, { type: 'video', media: dados, mimetype: vid.mimetype || 'video/mp4', caption: legenda, ...(vid.gifPlayback ? { gifPlayback: true } : {}) }, { quote: selo, mentions })
                else if(aud) await diablo.message.send(from, { type: 'audio', media: dados, mimetype: aud.mimetype || 'audio/mpeg', ptt: !!aud.ptt }, { quote: selo, mentions })
                else if(fig) await diablo.message.send(from, { type: 'sticker', media: dados, mimetype: fig.mimetype || 'image/webp' }, { quote: selo, mentions })
                else await diablo.message.send(from, { type: 'document', media: dados, mimetype: doc.mimetype || 'application/octet-stream', fileName: doc.fileName || 'arquivo', caption: legenda }, { quote: selo, mentions })
            } finally { try { fs.unlinkSync(tmp) } catch {} }
        } else {
            return reply('❌ Esse tipo de mensagem não dá para marcar. Responda um texto, foto, vídeo, áudio, figurinha, documento ou contato.')
        }
    }
} catch (e) {
    console.log('[TOTAG]', e)
    reply('❌ Erro ao marcar os participantes.')
}
break

case 'hidetag':
case 'tagoculta':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const mentions = (metadata.participants || []).map(p => p.jid).filter(Boolean)
    if(!mentions.length) return reply('❌ Não foi possível obter os participantes do grupo.')
    const textoCitado = citado?.conversation || citado?.extendedTextMessage?.text || ''
    const texto = String(q || '').trim() || textoCitado
    if(!texto) return reply(`*Use:* ${prefix}hidetag texto\n_ou responda uma mensagem de texto com ${prefix}hidetag._`)
    await diablo.message.send(from, { type: 'text', text: texto }, { mentions })
} catch (e) {
    console.log('[HIDETAG]', e)
    reply('❌ Erro ao marcar os participantes.')
}
break

case 'revelar':
case 'rvo':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
{
    const media = citado?.viewOnceMessage?.message || citado?.viewOnceMessageV2?.message || citado?.viewOnceMessageV2Extension?.message || citado
    const img = media?.imageMessage, vid = media?.videoMessage, aud = media?.audioMessage
    if(!img && !vid && !aud) return reply('*Marque uma imagem, vídeo ou áudio em visualização única.*')
    const tmp = path.join(__dirname, 'dados', 'media', `.rvo-${Date.now()}`)
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    try {
        await diablo.message.downloadToFile(media, tmp)
        const dados = fs.readFileSync(tmp)
        const original = img?.caption || vid?.caption || ''
        const legenda = `👁️ *Mídia revelada!*${original ? `\n\n${original}` : ''}`
        if(img) await diablo.message.send(from, { type: 'image', media: dados, mimetype: img.mimetype || 'image/jpeg', caption: legenda }, { quote: selo })
        else if(vid) await diablo.message.send(from, { type: 'video', media: dados, mimetype: vid.mimetype || 'video/mp4', caption: legenda, ...(vid.gifPlayback ? { gifPlayback: true } : {}) }, { quote: selo })
        else await diablo.message.send(from, { type: 'audio', media: dados, mimetype: aud.mimetype || 'audio/mpeg', ptt: !!aud.ptt }, { quote: selo })
    } catch (e) {
        console.log('[REVELAR]', e)
        reply('*Não consegui revelar essa mídia.* Ela pode já ter expirado ou não estar mais disponível.')
    } finally { try { fs.unlinkSync(tmp) } catch {} }
}
break

case 'marcar':
case 'marcarall':
case 'marcartodos':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const participantes = metadata.participants || []

    // Filtra somente membros que não são administradores
    const lista = participantes
        .filter(p => !p.admin && !p.isAdmin && !p.isSuperAdmin)
        .map(p => p.jid)
        .filter(Boolean)

    if(!lista.length) return reply('❌ Não há membros comuns para marcar.')

    const marcacoes = lista.map(jid => `@${jid.split('@')[0]}`).join('\n')

    const texto = `⸺͟͞ꪶ𝙼𝙰𝚁𝙲𝙰𝙽𝙳𝙾 𝙼𝙀𝙼𝙱𝚁𝙾𝚂 𝙳𝙾 𝙶𝚁𝚄𝙿𝙾᭄
 • ➮ ${groupName || 'Meu lugar'}
 • ➮ *_${q || 'Nada especificado'}_*

 ꒰১°᳝ꯥ‧ٓ➭
${marcacoes}`

    return await diablo.message.send(from, {
        type: 'text',
        text: texto
    }, {
        quote: selo,
        mentions: lista
    })
} catch(e) {
    console.log('[MARCAR]', e)
    return reply('❌ Erro ao marcar os membros do grupo.')
}
break

case 'marcar2':
case 'marcartodos2':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const participantes = metadata.participants || []
    const lista = participantes.map(p => p.jid).filter(Boolean)

    if(!lista.length) return reply('❌ Não foi possível obter os participantes do grupo.')

    const marcacoes = lista.map(jid => `@${jid.split('@')[0]}`).join('\n')

    const texto = `⸺͟͞ꪶ𝙼𝙰𝚁𝙲𝙰𝙽𝙳𝙾 𝙼𝙴𝙼𝙱𝚁𝙾𝚂 𝙳𝙾 𝙶𝚁𝚄𝙿𝙾᭄
 • ➮ ${groupName || 'Meu lugar'}
 • ➮ *_${q || 'Nada especificado'}_*

 ꒰১°᳝ꯥ‧ٓ➭
${marcacoes}`

    return await diablo.message.send(from, {
        type: 'text',
        text: texto
    }, {
        quote: selo,
        mentions: lista
    })
} catch(e) {
    console.log('[MARCAR2]', e)
    return reply('❌ Erro ao marcar os membros do grupo.')
}
break

case 'marcarwa':
case 'marcar-wa':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const participantes = metadata.participants || []

    const numeros = [...new Set(participantes.map(p => {
        const numero = p.phoneNumber || p.jid || p.participantAlt
        if(!numero) return null
        const limpo = String(numero).split('@')[0].replace(/\D/g, '')
        return limpo.length >= 10 ? limpo : null
    }).filter(Boolean))]

    if(!numeros.length) return reply('❌ Não foi possível obter os números dos participantes.')

    const links = numeros.map(numero => `꒰১°᳝ꯥ‧ٓ➭ https://wa.me/${numero}`).join('\n')

    const texto = `⸺͟͞ꪶ𝙼𝙰𝚁𝙲𝙰𝙽𝙳𝙾 𝚃𝙾𝙳𝙊𝚂 𝚆𝙰.𝙼𝙴᭄

 • ➮ ${groupName || 'Meu lugar'}
 • ➮ *_${q || 'Nada especificado'}_*

${links}`

    return await diablo.message.send(from, {
        type: 'text',
        text: texto
    }, {
        quote: selo
    })
} catch(e) {
    console.log('[MARCARWA]', e)
    return reply('❌ Erro ao gerar os links dos participantes.')
}
break

case 'papof':
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
try {
    const metadata = await diablo.group.queryGroupMetadata(from)
    const lista = (metadata.participants || []).map(p => p.jid).filter(Boolean)
    if(!lista.length) return reply('❌ Não foi possível obter os participantes.')

    const texto = `【᯽𒋨📷:𝑆𝑒 𝑎𝑝𝑟𝑒𝑠𝑒𝑛𝑡𝑒𝑚 🌚»°】
𒋨·࣭࣪̇🔥ɴᴏᴍᴇ:
𒋨·࣭࣪̇🔥ɪᴅᴀᴅᴇ:
𒋨·࣭࣪̇🔥CIDADE:
*Aᴘʀᴇsᴇɴᴛᴇ-sᴇ sᴇ.*

──╌╌╌┈⊰★⊱┈╌╌╌┈─
❌ ENTROU NO 
GRUPO INTERAJA, NÃO PRECISAMOS DE ENFEITES, INATIVOS SERAO REMOVIDOS ❌

/﹋<,︻╦╤─ ҉ - -----💥
/﹋ 🅴 🅱🅴🅼 🆅🅸🅽🅳🅾`

    return await diablo.message.send(from, {
        type: 'text',
        text: texto
    }, {
        quote: selo,
        mentions: lista
    })
} catch(e) {
    console.log('[PAPOF]', e)
    return reply('❌ Erro ao mencionar os participantes.')
}
break

case 'gp':
case 'grupo': {
if(!grupo) return reply(mess.onlyGroup())
if(!admin && !dono) return reply(mess.onlyAdmins())
if(!botadm) return reply(mess.onlyBotAdmin())

const opcao = normGatilho(args[0] || '')

if(opcao === 'a') {
const r = await abrirGrupoApi(diablo, from)
if(!r.ok) return reply('*❌ Não consegui abrir o grupo.* Confirme se eu sou admin.')
await diablo.message.send(from, { type: 'text', text: '*🔓 ɢʀᴜᴘᴏ ᴀʙᴇʀᴛᴏ!*\n\n_Agora todos os membros podem enviar mensagens._' }, { quote: selo })
} else if(opcao === 'f') {
const r = await fecharGrupoApi(diablo, from)
if(!r.ok) return reply('*❌ Não consegui fechar o grupo.* Confirme se eu sou admin.')
await diablo.message.send(from, { type: 'text', text: '*🔒 ɢʀᴜᴘᴏ ꜰᴇᴄʜᴀᴅᴏ!*\n\n_Agora só os admins podem enviar mensagens._' }, { quote: selo })
} else {
return reply(`*📌 ᴍᴇɴᴜ ɢᴘ*\n\n*${prefix}gp A* ➜ abrir o grupo 🔓\n*${prefix}gp F* ➜ fechar o grupo 🔒`)
}
}
break

case 'regras':
case 'infogp':
case 'infogrupo':
case 'regrasgp': {
if(!grupo) return reply(mess.onlyGroup())

const nomeGp = groupName || 'Meu lugar'
const totalMembros = groupMembers.length
const descGp = String(groupDesc || '').trim() || 'Sem descrição definida.'

const texto = `┏┉✯┉━═『アカメ』═━┉✯┉┓
║が斬る𝐈𝐍𝐅𝐎/𝐆𝐑𝐔𝐏𝐎が斬る
┗┉✯┉━═『アカメ』═━┉✯┉┛
*💫NOME⧽* ${nomeGp}
*👥MEMBROS⧽* ${totalMembros}

*📌DESCRIÇÃO* : 
${descGp}`

let foto = ''
try { foto = (await diablo.profile.getProfilePicture(from, 'image'))?.url || '' } catch {}

if(foto) {
try {
const media = await baixar(foto)
return await diablo.message.send(from, { type: 'image', media, mimetype: 'image/jpeg', caption: texto }, { quote: selo })
} catch {}
}
return await diablo.message.send(from, { type: 'text', text: texto }, { quote: selo })
}
break

//=============[ DONO ]=============\\

case 'verificado': {
if(!dono) return reply(mess.onlyOwner())
const novoEstado = !isVerificado
atualizarSelo(novoEstado)
await reply(novoEstado
? '*✅ ѕᴇʟᴏ ᴠᴇʀɪғɪᴄᴀᴅᴏ ᴀᴛɪᴠᴀᴅᴏ ᴇᴍ ᴛᴏᴅᴏѕ ᴏѕ ᴇɴᴠɪᴏѕ.*'
: '*❌ ѕᴇʟᴏ ᴠᴇʀɪғɪᴄᴀᴅᴏ ᴅᴇѕᴀᴛɪᴠᴀᴅᴏ. ᴏѕ ᴇɴᴠɪᴏѕ ᴠᴏʟᴛᴀᴍ ᴀ ᴄɪᴛᴀʀ ᴀ ᴍᴇɴѕᴀɢᴇᴍ ᴏʀɪɢɪɴᴀʟ.*')
}
break

case 'prefixo':
case 'setprefix':
if(!dono) return reply(mess.onlyOwner())
if(!q || /\s/.test(q) || q.length > 3) return reply(`*ᴇxᴇᴍᴘʟᴏ: ${prefix}prefixo .*`)
prefix = q; setCfg('prefix', q)
reply(`*ᴘʀᴇғɪxᴏ ᴀʟᴛᴇʀᴀᴅᴏ ᴘᴀʀᴀ: ${q}*`)
break

case 'nomedono':
case 'setdono':
if(!dono) return reply(mess.onlyOwner())
if(!q) return reply(`*ᴇxᴇᴍᴘʟᴏ: ${prefix}nomedono Dylan Modz*`)
ownerName = q; setCfg('ownerName', q)
reply(`*ɴᴏᴍᴇ ᴅᴏ ᴅᴏɴᴏ ᴀʟᴛᴇʀᴀᴅᴏ ᴘᴀʀᴀ: ${q}*`)
break

case 'numerodono':
case 'setnumero': {
if(!dono) return reply(mess.onlyOwner())
const n = q.replace(/\D/g, '')
if(n.length < 10) return reply(`*ᴇxᴇᴍᴘʟᴏ: ${prefix}numerodono 5599999999999*`)
ownerNumber = n; setCfg('ownerNumber', n)
reply('*ɴᴜᴍᴇʀᴏ ᴅᴏ ᴅᴏɴᴏ ᴀʟᴛᴇʀᴀᴅᴏ.*')
}
break

case 'fotomenu': {
if(!dono) return reply(mess.onlyOwner())

const fonte = citado || m
const media = fonte?.viewOnceMessage?.message || fonte?.viewOnceMessageV2?.message || fonte
const videoMsg = media?.videoMessage
const imagemMsg = media?.imageMessage
const pasta = path.join(__dirname, 'dados', 'media')
const arquivos = ['fotomenu.mp4', 'fotomenu.png', 'fotomenu.jpg', 'fotomenu.jpeg'].map(v => path.join(pasta, v))
const limpar = () => arquivos.forEach(v => { if(fs.existsSync(v)) fs.unlinkSync(v) })
fs.mkdirSync(pasta, { recursive: true })

if(videoMsg) {
await reagir('⏳').catch(() => {})
limpar()
await diablo.message.downloadToFile(media, path.join(pasta, 'fotomenu.mp4'))
await reagir('✅').catch(() => {})
return reply('*ᴠɪᴅᴇᴏ ᴅᴏ ᴍᴇɴᴜ sᴀʟᴠᴏ.*')
}

if(imagemMsg) {
await reagir('⏳').catch(() => {})
const ext = String(imagemMsg?.mimetype || '').toLowerCase().includes('png') ? 'png' : 'jpg'
limpar()
await diablo.message.downloadToFile(media, path.join(pasta, `fotomenu.${ext}`))
await reagir('✅').catch(() => {})
return reply('*ғᴏᴛᴏ ᴅᴏ ᴍᴇɴᴜ sᴀʟᴠᴀ.*')
}

reply('*ᴍᴀɴᴅᴇ ᴜᴍᴀ ɪᴍᴀɢᴇᴍ/ᴠɪᴅᴇᴏ ᴄᴏᴍ ᴏ ᴄᴏᴍᴀɴᴅᴏ ᴏᴜ ʀᴇsᴘᴏɴᴅᴀ ᴜᴍᴀ ᴍɪᴅɪᴀ.*')
}
break

case 'reiniciar':
case 'restart':
if(!dono) return reply(mess.onlyOwner())
await reply(mess.reiniciando())
setTimeout(() => {
const filho = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'inherit' })
filho.unref(); process.exit(0)
}, 700)
break

//=============[ DOWNLOADS ]=============\\

case 'play':
case 'p': {
try {
if(!q) return reply(`*🎵 | ᴇxᴇᴍᴘʟᴏ: ${prefix + command} nome da música*\n\n> A música será baixada em áudio. Se não baixar, o YouTube pode ter bloqueado o download.`)
await reply(mess.wait())

const r = await baixarAudioYtdlp(q.trim(), path.join(__dirname, 'dados', 'media'))

const info_musica = `*🎵 | ᴛɪ́ᴛᴜʟᴏ:* ${r.info.titulo}

*📝 | ᴅᴇsᴄʀɪᴄᴀᴏ:* ${r.info.desc}

*📺 | ᴄᴀɴᴀʟ:* ${r.info.canal}`

if(r.info.thumb) await imagem(from, r.info.thumb, info_musica).catch(() => reply(info_musica))
else await reply(info_musica)

await diablo.message.send(from, { type: 'audio', media: r.buffer, mimetype: r.mimetype, ptt: false }, { quote: selo })
console.log('[PLAY] ok:', r.ext, r.buffer.length, 'bytes')
} catch(e) {
console.log('[PLAY] erro:', e?.message || e)
if(e?.code === 'LONGO') return reply('*⏰ ᴇsᴛᴇ ᴠɪ́ᴅᴇᴏ ᴇ́ ᴍᴜɪᴛᴏ ɢʀᴀɴᴅᴇ (ᴍᴀɪs ᴅᴇ 1 ʜᴏʀᴀ). ᴇsᴄᴏʟʜᴀ ᴜᴍᴀ ᴍᴜ́sɪᴄᴀ ᴍᴀɪs ᴄᴜʀᴛᴀ.*')
return reply('*❌ ᴇʀʀᴏ ᴀᴏ ʙᴀɪxᴀʀ ᴀ ᴍᴜ́sɪᴄᴀ. sᴇᴊᴀ ᴍᴀɪs ᴇsᴘᴇᴄɪ́ғɪᴄᴏ ᴏᴜ ᴛᴇɴᴛᴇ ᴏᴜᴛʀᴏ ɴᴏᴍᴇ.*')
}
}
break

//=============[ PLAY MP4 / PLAY VIDEO ]=============\\

case 'playmp4':
case 'play_video': {
try {
    if(!q.trim()) {
        return reply(`🎥 Exemplo: ${prefix}play_video nome do vídeo\n\n📝 O vídeo será baixado. Se não baixar, o YouTube pode ter bloqueado o download.`)
    }

    await reply('🔎 Pesquisando vídeo...')

    const urlPesquisa = `https://api.bronxyshost.com.br/api-bronxys/pesquisa_ytb?nome=${encodeURIComponent(q)}&apikey=${API_KEY_BRONXYS}`
    const resposta = await fetch(urlPesquisa)

    if(!resposta.ok) {
        return reply(`❌ Erro na pesquisa: HTTP ${resposta.status}`)
    }

    const data = await resposta.json()

    if(!Array.isArray(data) || !data.length) {
        return reply('❌ Vídeo não encontrado. Tente outro nome.')
    }

    if(data[0]?.tempo?.length >= 7) {
        return reply('⏰ Este vídeo tem mais de 1 hora. Escolha um vídeo mais curto.')
    }

    const N_E = '❌ Não encontrado.'

    const legenda = `🎥 Título: ${data[0]?.titulo || N_E}
⏱️ Tempo: ${data[0]?.tempo || N_E}
📅 Postado: ${data[0]?.postado || N_E}
📝 Descrição: ${data[0]?.desc || N_E}

■■■■■ 100%

🎥 Preparando vídeo...

🎵 Para baixar apenas o áudio, use:
${prefix}play ${q.trim()}`

    const thumb = data[0]?.thumb || logoslink?.logo

    if(thumb) {
        await diablo.message.send(from, {
            type: 'image',
            media: thumb
        }, {
            quote: selo,
            caption: legenda
        }).catch(async () => {
            await reply(legenda)
        })
    } else {
        await reply(legenda)
    }

    const urlVideo = `https://api.bronxyshost.com.br/api-bronxys/play_video?nome_url=${encodeURIComponent(q)}&apikey=${API_KEY_BRONXYS}`
    const respVideo = await fetch(urlVideo)

    if(!respVideo.ok) {
        return reply(`❌ Erro ao baixar vídeo: HTTP ${respVideo.status}`)
    }

    const video = Buffer.from(await respVideo.arrayBuffer())

    await diablo.message.send(from, {
        type: 'video',
        media: video,
        mimetype: 'video/mp4',
        fileName: `${data[0]?.titulo || 'play'}.mp4`
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[PLAY MP4]', e)
    return reply('🔍 Não consegui encontrar ou baixar esse vídeo. Tente outro nome.')
}
}
break


//=============[ PLAY DOC ]=============\\

case 'playdoc':
try {
    if(!q.trim()) {
        return reply(`📄 Exemplo: ${prefix}playdoc nome da música\n\n📝 A música será enviada como documento.`)
    }

    await reply('🔎 Pesquisando música...')

    const urlPesquisa = `https://api.bronxyshost.com.br/api-bronxys/pesquisa_ytb?nome=${encodeURIComponent(q)}&apikey=${API_KEY_BRONXYS}`
    const resposta = await fetch(urlPesquisa)

    if(!resposta.ok) {
        return reply(`❌ Erro na pesquisa: HTTP ${resposta.status}`)
    }

    const data = await resposta.json()

    if(!Array.isArray(data) || !data.length) {
        return reply('❌ Música não encontrada.')
    }

    if(data[0]?.tempo?.length >= 7) {
        return reply('⏰ Este conteúdo tem mais de 1 hora. Escolha uma música mais curta.')
    }

    const N_E = '❌ Não encontrado.'

    const legenda = `📄 Título: ${data[0]?.titulo || N_E}
⏱️ Tempo: ${data[0]?.tempo || N_E}
📅 Postado: ${data[0]?.postado || N_E}
📝 Descrição: ${data[0]?.desc || N_E}

■■■■■ 100%

📄 Preparando documento...

🎥 Para baixar o VÍDEO:
${prefix}playmp4 ${q.trim()}

🎵 Para baixar o ÁUDIO:
${prefix}play ${q.trim()}`

    await reply(legenda)

    const urlAudio = `https://api.bronxyshost.com.br/api-bronxys/play?nome_url=${encodeURIComponent(q)}&apikey=${API_KEY_BRONXYS}`
    const respAudio = await fetch(urlAudio)

    if(!respAudio.ok) {
        return reply(`❌ Erro ao baixar áudio: HTTP ${respAudio.status}`)
    }

    const audio = Buffer.from(await respAudio.arrayBuffer())

    await diablo.message.send(from, {
        type: 'document',
        media: audio,
        mimetype: 'audio/mpeg',
        fileName: `${data[0]?.titulo || 'play'}.mp3`
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[PLAY DOC]', e)
    return reply('❌ Erro ao baixar documento. Tente novamente.')
}
break


//=============[ TIKTOK VIDEO ]=============\\

case 'tiktok_video':
try {
    if(!/tiktok\.com/i.test(q)) {
        return reply(`🎬 Exemplo: ${prefix + command} link do TikTok\n\nCole o link completo do vídeo.`)
    }

    await reply('🎬 Baixando vídeo do TikTok...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/tiktok?url=${encodeURIComponent(q.trim())}&apikey=${API_KEY_BRONXYS}`
    const resp = await fetch(url)

    if(!resp.ok) return reply(`❌ Erro na API: HTTP ${resp.status}`)

    const video = Buffer.from(await resp.arrayBuffer())

    await diablo.message.send(from, {
        type: 'video',
        media: video,
        mimetype: 'video/mp4'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[TIKTOK VIDEO]', e)
    return reply('❌ Erro ao baixar vídeo do TikTok.')
}
break


//=============[ TIKTOK AUDIO ]=============\\

case 'tiktok_audio':
try {
    if(!/tiktok\.com/i.test(q)) {
        return reply(`🎵 Exemplo: ${prefix + command} link do TikTok\n\nCole o link completo do vídeo.`)
    }

    await reply('🎵 Extraindo áudio do TikTok...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/tiktok?url=${encodeURIComponent(q.trim())}&apikey=${API_KEY_BRONXYS}`
    const resp = await fetch(url)

    if(!resp.ok) return reply(`❌ Erro na API: HTTP ${resp.status}`)

    const audio = Buffer.from(await resp.arrayBuffer())

    await diablo.message.send(from, {
        type: 'audio',
        media: audio,
        mimetype: 'audio/mpeg'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[TIKTOK AUDIO]', e)
    return reply('❌ Erro ao extrair áudio do TikTok.')
}
break


//=============[ FACEBOOK VIDEO / AUDIO ]=============\\

case 'face_video':
case 'face_audio':
try {
    if(!/facebook\.com|fb\.watch/i.test(q)) {
        return reply(`📘 Exemplo: ${prefix + command} link do Facebook`)
    }

    await reply('📥 Baixando conteúdo...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/${command}?url=${encodeURIComponent(q.trim())}&apikey=${API_KEY_BRONXYS}`
    const resp = await fetch(url)

    if(!resp.ok) return reply(`❌ Erro na API: HTTP ${resp.status}`)

    const dados = Buffer.from(await resp.arrayBuffer())
    const ehVideo = command === 'face_video'

    await diablo.message.send(from, {
        type: ehVideo ? 'video' : 'audio',
        media: dados,
        mimetype: ehVideo ? 'video/mp4' : 'audio/mpeg'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[FACEBOOK]', e)
    return reply('❌ Erro ao processar conteúdo do Facebook.')
}
break


//=============[ TWITTER VIDEO / AUDIO ]=============\\

case 'twitter_video':
case 'twitter_audio':
try {
    if(!/twitter\.com|x\.com/i.test(q)) {
        return reply(`🐦 Exemplo: ${prefix + command} link do Twitter/X`)
    }

    await reply('📥 Baixando conteúdo...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/${command}?url=${encodeURIComponent(q.trim())}&apikey=${API_KEY_BRONXYS}`
    const resp = await fetch(url)

    if(!resp.ok) return reply(`❌ Erro na API: HTTP ${resp.status}`)

    const dados = Buffer.from(await resp.arrayBuffer())
    const ehVideo = command === 'twitter_video'

    await diablo.message.send(from, {
        type: ehVideo ? 'video' : 'audio',
        media: dados,
        mimetype: ehVideo ? 'video/mp4' : 'audio/mpeg'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[TWITTER]', e)
    return reply('❌ Erro ao processar conteúdo do Twitter/X.')
}
break


//=============[ INSTAGRAM ]=============\\

case 'instagram':
case 'insta_audio':
try {
    if(!/instagram\.com/i.test(q)) {
        return reply(`📷 Exemplo: ${prefix + command} link do Instagram`)
    }

    await reply('📥 Buscando conteúdo do Instagram...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/instagram?url=${encodeURIComponent(q.trim())}&apikey=${API_KEY_BRONXYS}`
    const resp = await fetch(url)

    if(!resp.ok) return reply(`❌ Erro na API: HTTP ${resp.status}`)

    const ABC = await resp.json()
    const item = ABC?.msg?.[0]

    if(!item?.url) {
        console.log('[INSTAGRAM] Resposta:', JSON.stringify(ABC))
        return reply('❌ A API não retornou uma mídia válida.')
    }

    const tipo = String(item.type || '').toLowerCase()
    const ehAudio = command === 'insta_audio'

    let mediaType = 'video'
    let mimetype = 'video/mp4'

    if(tipo === 'jpg') {
        mediaType = 'image'
        mimetype = 'image/jpeg'
    } else if(tipo === 'webp') {
        mediaType = 'image'
        mimetype = 'image/webp'
    } else if(tipo === 'mp3') {
        mediaType = 'audio'
        mimetype = 'audio/mpeg'
    } else if(ehAudio) {
        mediaType = 'audio'
        mimetype = 'audio/mpeg'
    }

    const midiaResp = await fetch(item.url)

    if(!midiaResp.ok) {
        return reply(`❌ Erro ao baixar mídia: HTTP ${midiaResp.status}`)
    }

    const dados = Buffer.from(await midiaResp.arrayBuffer())

    await diablo.message.send(from, {
        type: mediaType,
        media: dados,
        mimetype
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[INSTAGRAM]', e)
    return reply('❌ Erro ao processar conteúdo do Instagram.')
}
break

//=============[ LOGOS EPH ]=============\\

case 'angelwing':
case 'hackneon':
case 'fpsmascote':
case 'equipemascote':
case 'txtquadrinhos':
case 'ffavatar':
case 'mascotegame':
case 'angelglx':
case 'gizquadro':
case 'wingeffect':
case 'blackpink':
case 'metalgold':
case 'girlmascote':
case 'logogame':
try {
    if(!q.trim()) return reply(`Digite algo, Exemplo: ${prefix + command} bronxys`)

    await reply('⏳ Realizando ação...')

    const resposta = await fetch(
        `https://api.bronxyshost.com.br/api-bronxys/logos_EPH?texto=${encodeURIComponent(q)}&category=${command}&apikey=${API_KEY_BRONXYS}`
    )

    const ABC = await resposta.json()

    if(!ABC?.resultado) {
        return reply('*❌ Não foi possível gerar a logo.*')
    }

    const imagem = await fetch(ABC.resultado)
    const dados = Buffer.from(await imagem.arrayBuffer())

    await diablo.message.send(from, {
        type: 'image',
        media: dados,
        mimetype: 'image/jpeg'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[LOGOS EPH]', e)
    return reply('*❌ Erro ao gerar a logo.*')
}
break


//=============[ LOGOS PHT ]=============\\

case 'shadow':
case 'cup':
case 'txtborboleta':
case 'cemiterio':
case 'efeitoneon':
case 'harryp':
case 'lobometal':
case 'neon2':
case 'madeira':
case 'lovemsg3':
case 'coffecup':
case 'coffecup2':
case 'florwooden':
case 'narutologo':
case 'fire':
case 'romantic':
case 'smoke':
case 'papel':
case 'lovemsg':
case 'lovemsg2':
try {
    if(!q.trim()) return reply(`Digite algo, Exemplo: ${prefix + command} bronxys`)

    await reply('⏳ Realizando ação...')

    const resposta = await fetch(
        `https://api.bronxyshost.com.br/api-bronxys/logos_PHT?texto=${encodeURIComponent(q)}&category=${command}&apikey=${API_KEY_BRONXYS}`
    )

    const ABC = await resposta.json()

    const url = ABC?.resultado?.imageUrl

    if(!url) {
        return reply('*❌ Não foi possível gerar a logo.*')
    }

    const imagem = await fetch(url)
    const dados = Buffer.from(await imagem.arrayBuffer())

    await diablo.message.send(from, {
        type: 'image',
        media: dados,
        mimetype: 'image/jpeg'
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[LOGOS PHT]', e)
    return reply('*❌ Erro ao gerar a logo.*')
}
break

//=============[ GERAR NICK ]=============\\

case 'gerarnick':
try {
    if(!q.trim()) {
        return reply(`Escreva um nome para eu enviar com letras modificadas.\n\nExemplo: ${prefix + command} bronxys`)
    }

    await reply('⏳ Realizando ação...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/gerar_nick?nick=${encodeURIComponent(q)}&apikey=${API_KEY_BRONXYS}`

    const resposta = await fetch(url)

    if(!resposta.ok) {
        return reply(`*❌ Erro na API: HTTP ${resposta.status}*`)
    }

    const ABC = await resposta.json()

    if(!Array.isArray(ABC) || !ABC.length) {
        return reply('*❌ Não foram encontradas opções para esse nome.*')
    }

    let AB = `*✨ LISTA DE NICKS ✨*\n\n`

    for(const i of ABC) {
        AB += `${i}\n\n`
    }

    return reply(AB)

} catch(e) {
    console.log('[GERARNICK]', e)
    return reply('*❌ Erro ao gerar os nicks.*')
}
break


//=============[ ATTP ]=============\\

case 'attp':
case 'attp2':
try {
    if(!q.trim()) {
        return reply(`Exemplo: ${prefix + command} bronxys`)
    }

    await reply('⏳ Realizando ação...')

    const fonte = command === 'attp2'
        ? 'Roboto'
        : 'Noto Emoji, Noto Sans Mono'

    const url = `https://api.bronxyshost.com.br/api-bronxys/attp_edit?texto=${encodeURIComponent(q)}&fonte=${encodeURIComponent(fonte)}&apikey=${API_KEY_BRONXYS}`

    const resposta = await fetch(url)

    if(!resposta.ok) {
        return reply(`*❌ Erro na API: HTTP ${resposta.status}*`)
    }

    const dados = Buffer.from(await resposta.arrayBuffer())

    await diablo.message.send(from, {
        type: 'sticker',
        media: dados
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[ATTP]', e)
    return reply('*❌ Erro ao gerar a figurinha.*')
}
break


//=============[ TTP WHITE / BRAT ]=============\\

case 'ttp_white':
case 'ttp_brat':
try {
    if(!q.trim()) {
        return reply(`🎨 Exemplo: ${prefix + command} seu texto aqui`)
    }

    await reply('🎨 Realizando ação, aguarde...')

    const url = `https://api.bronxyshost.com.br/api-bronxys/${command}?texto=${encodeURIComponent(q)}&fonte=Arial&apikey=${API_KEY_BRONXYS}`

    const resposta = await fetch(url)

    if(!resposta.ok) {
        return reply(`*❌ Erro na API: HTTP ${resposta.status}*`)
    }

    const dados = Buffer.from(await resposta.arrayBuffer())

    await diablo.message.send(from, {
        type: 'sticker',
        media: dados
    }, {
        quote: selo
    })

} catch(e) {
    console.log('[TTP]', e)
    return reply('*❌ Erro ao gerar figurinha.*')
}
break


//=============[ ATTP WHITE / BRAT ]=============\\

case 'attp_white':
case 'attp_brat':
case 'attp_white_video':
case 'attp_brat_video':
try {
    if(!q.trim()) {
        return reply(`🎬 Exemplo: ${prefix + command} seu texto aqui`)
    }

    await reply('🎬 Realizando ação, aguarde...')

    const isVideo = String(command).includes('_video')
    const baseEndpoint = String(command).replace('_video', '')
    const typeParam = isVideo ? '&type=video' : ''

    const url = `https://api.bronxyshost.com.br/api-bronxys/${baseEndpoint}?texto=${encodeURIComponent(q)}&fonte=Arial${typeParam}&apikey=${API_KEY_BRONXYS}`

    const resposta = await fetch(url)

    if(!resposta.ok) {
        return reply(`*❌ Erro na API: HTTP ${resposta.status}*`)
    }

    const dados = Buffer.from(await resposta.arrayBuffer())

    if(isVideo) {
        await diablo.message.send(from, {
            type: 'video',
            media: dados,
            mimetype: 'video/mp4'
        }, {
            quote: selo
        })
    } else {
        await diablo.message.send(from, {
            type: 'sticker',
            media: dados
        }, {
            quote: selo
        })
    }

} catch(e) {
    console.log('[ATTP WHITE/BRAT]', e)
    return reply('*❌ Erro ao gerar o conteúdo.*')
}
break

case 'x92': {
  if(!grupo) return reply(mess.onlyGroup())
  if(!admin && !dono) return reply(mess.onlyAdmins())
  if(!botadm) return reply(mess.onlyBotAdmin())

  dataGp[0].x9 = !dataGp[0].x9
  setGp(dataGp)

  reply(dataGp[0].x9
    ? '*X9-ADM ATIVO COM SUCESSO🙅‍♀️⚔️️*'
    : '*X9-ADM DESATIVADO COM SUCESSO❌*'
  )
}
break

} // <--- CORRETO: Chave do switch fecha após o último case

//=============[ FIM ]=============\\

} // <--- Chave de fechamento da função startdiablo



//=============[ ATUALIZAÇÃO ]=============\\

fs.watchFile(require.resolve(__filename), { interval: 1000 }, () => {
fs.unwatchFile(require.resolve(__filename))
console.log(chalk.blue(`Alterações salvas, carregando novamente: '${__filename}'`))
delete require.cache[require.resolve(__filename)]
})

module.exports = startdiablo
