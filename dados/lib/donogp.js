const { numero, ids, achar, alvo } = require('./main.js')

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

/** Diz se quem enviou a mensagem é o dono do grupo registrado. */
function ehDonoDoGrupo(registro, membro, ...jids) {
if(!registro?.ids?.length) return false
const lista = [...(membro ? ids(membro) : []), ...jids].map(texto).filter(Boolean)
return lista.length > 0 && mesmo(lista, registro.ids)
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
if(mesmo(listaAutor, registro.ids)) return null // foi o dono do grupo: permitido
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
ehDono: mesmo(lista, registro.ids),
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

module.exports = { guardarDono, ehDonoDoGrupo, analisarAdmin }
