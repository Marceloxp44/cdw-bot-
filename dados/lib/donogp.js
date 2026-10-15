const { numero, ids, achar, alvo } = require('./main.js')

// Máximo de donos por grupo (altere aqui se quiser mais)
const LIMITE_DONOS = 5

const texto = v => (typeof v === 'string' ? v : '')

function mesmo(a, b) {
return a.some(x => b.some(y => x === y || (numero(x) && numero(x) === numero(y))))
}

function jidDoParticipante(p) {
return typeof p === 'string' ? p : (p?.jid || p?.phoneJid || p?.pnJid || p?.lidJid || '')
}

/** Dados do admin que será salvo como dono do grupo (guarda todos os IDs: número e LID). */
function guardarDono(membro, ref = '') {
return {
jid: alvo(membro, ref),
ids: ids(membro).concat(ref ? [String(ref)] : []).filter((v, i, a) => v && a.indexOf(v) === i),
desde: Date.now()
}
}

/** Dono do grupo + autorizados (ex.: o outro bot, co-donos). */
function registrados(registro) {
return [registro, ...(registro?.autorizados || [])].filter(r => r?.ids?.length)
}

/** Diz se quem enviou a mensagem é o dono do grupo registrado ou um autorizado. */
function ehDonoDoGrupo(registro, membro, ...jids) {
if(!registro?.ids?.length) return false
const lista = [...(membro ? ids(membro) : []), ...jids].map(texto).filter(Boolean)
return lista.length > 0 && registrados(registro).some(r => mesmo(lista, r.ids))
}

/** JIDs de todos os donos registrados (o principal primeiro). */
function listarDonos(registro) {
return registrados(registro).map(r => r.jid).filter(Boolean)
}

/**
 * Registra mais um dono. Retorna { registro, status }, com status 'novo', 'ja' (já era dono) ou 'limite'.
 */
function adicionarDono(registro, membro, ref = '') {
if(!registro?.ids?.length) return { registro: { ...guardarDono(membro, ref), autorizados: [] }, status: 'novo' }
const novoIds = guardarDono(membro, ref).ids
if(registrados(registro).some(r => mesmo(novoIds, r.ids))) return { registro, status: 'ja' }
if(registrados(registro).length >= LIMITE_DONOS) return { registro, status: 'limite' }
autorizar(registro, membro, ref)
return { registro, status: 'novo' }
}

/**
 * Remove um dono. Retorna { registro, removeu }. Se era o último, registro vem null (proteção desligada).
 * Se removeu o principal, o próximo da lista assume o lugar.
 */
function removerDono(registro, membro, ref = '') {
if(!registro?.ids?.length) return { registro: null, removeu: false }
const alvoIds = guardarDono(membro, ref).ids
const todos = registrados(registro)
const restantes = todos.filter(r => !mesmo(alvoIds, r.ids))
if(restantes.length === todos.length) return { registro, removeu: false }
if(!restantes.length) return { registro: null, removeu: true }
const [principal, ...resto] = restantes
return { registro: { ...principal, autorizados: resto }, removeu: true }
}

/** Adiciona um autorizado (não duplica). Retorna o registro atualizado. */
function autorizar(registro, membro, ref = '') {
const novo = guardarDono(membro, ref)
const resto = (registro.autorizados || []).filter(a => !mesmo(a.ids, novo.ids))
registro.autorizados = [...resto, novo]
return registro
}

/** Remove um autorizado. Retorna true se removeu. */
function desautorizar(registro, membro, ref = '') {
const alvoIds = guardarDono(membro, ref).ids
const antes = (registro.autorizados || []).length
registro.autorizados = (registro.autorizados || []).filter(a => !mesmo(a.ids, alvoIds))
return registro.autorizados.length < antes
}

/**
 * Analisa um evento de promoção/rebaixamento e diz o que fazer.
 * Regra: com dono registrado, só ele (ou o dono do bot) pode promover/rebaixar.
 * Retorna null se não há nada a fazer, ou:
 * { acao, desfazer: [jids], punir, punirSuperAdmin, donoAfetado, mencionar }
 */
function analisarAdmin({ registro, info, groupMembers, botNumber, ownerNumber }) {
const acao = info?.action
if(!registro?.ids?.length || (acao !== 'demote' && acao !== 'promote')) return null

// Quem fez a ação?
const refAutor = texto(info?.authorJid) || texto(info?.author?.jid) || texto(info?.author)
const ator = achar(groupMembers, info?.authorJid, info?.author?.jid, info?.author)
const listaAutor = [...(ator ? ids(ator) : []), refAutor].map(texto).filter(Boolean)
const temAutor = listaAutor.length > 0

const bot = achar(groupMembers, botNumber)
const listaBot = [botNumber, ...(bot ? ids(bot) : [])].map(texto).filter(Boolean)
const donoBot = String(ownerNumber || '').replace(/\D/g, '')

if(temAutor) {
if(mesmo(listaAutor, listaBot)) return null // foi o próprio bot (evita loop)
if(registrados(registro).some(r => mesmo(listaAutor, r.ids))) return null // foi o dono do grupo ou um autorizado: permitido
if(donoBot && listaAutor.some(x => numero(x) === donoBot)) return null // dono do bot é isento
}

// Quem foi afetado?
const alvos = []
for(const p of info?.participants || []) {
const jid = jidDoParticipante(p)
const membro = achar(groupMembers, jid, p?.jid, p?.phoneJid, p?.pnJid, p?.lidJid)
const lista = [...(membro ? ids(membro) : []), jid, p?.jid, p?.phoneJid, p?.pnJid, p?.lidJid].map(texto).filter(Boolean)
if(!lista.length) continue
alvos.push({
jid: (membro && alvo(membro, jid)) || jid,
ehDono: registrados(registro).some(r => mesmo(lista, r.ids)),
ehBot: mesmo(lista, listaBot),
ehAutor: temAutor && mesmo(lista, listaAutor)
})
}

let desfazer
const donoAfetado = acao === 'demote' && alvos.some(a => a.ehDono)

if(acao === 'demote') {
if(!temAutor) {
// Sem saber quem foi, só protege o dono (não mexe nos demais)
if(!donoAfetado) return null
desfazer = alvos.filter(a => a.ehDono).map(a => a.jid)
} else {
// Quem se rebaixa sozinho ("sair do cargo") não é desfeito
desfazer = alvos.filter(a => !a.ehBot && !a.ehAutor).map(a => a.jid)
}
} else {
if(!temAutor) return null
// Promover o dono ou o bot não precisa ser desfeito
desfazer = alvos.filter(a => !a.ehDono && !a.ehBot).map(a => a.jid)
}
if(!desfazer.length) return null

const punir = temAutor ? ((ator && alvo(ator, refAutor)) || refAutor) : null
return {
acao,
desfazer,
punir: punir || null,
punirSuperAdmin: !!ator?.isSuperAdmin,
donoAfetado,
mencionar: [...desfazer, punir].filter(Boolean)
}
}

module.exports = { LIMITE_DONOS, guardarDono, ehDonoDoGrupo, listarDonos, adicionarDono, removerDono, autorizar, desautorizar, analisarAdmin }
