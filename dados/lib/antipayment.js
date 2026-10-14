/**
 * Anti-payment para o bot diablo (CommonJS).
 * Salve em: dados/lib/antipayment.js
 *
 * - detecta mensagens de pagamento (varredura recursiva, ignora quotedMessage)
 * - remove cada autor UMA vez (TTL curto) e apaga a mensagem em paralelo
 * - fecha o grupo UMA vez por incidente e reabre com debounce
 * - só reabre se o grupo estava ABERTO antes (não desfaz fechamento de admin)
 * - a reabertura sempre é agendada, mesmo se algum passo falhar
 */

//=============[ DETECÇÃO ]=============\\

const MAX_PROFUNDIDADE = 8
const CHAVES_PAGAMENTO = new Set([
  'paymentInviteMessage',
  'requestPaymentMessage',
  'sendPaymentMessage',
  'cancelPaymentRequestMessage',
  'declinePaymentRequestMessage',
  'invoiceMessage'
])

function podeVarrer(v) {
  return v && typeof v === 'object' && !(v instanceof ArrayBuffer) && !ArrayBuffer.isView(v)
}

function temPagamento(valor, prof = 0, vistos = new WeakSet()) {
  if (!podeVarrer(valor) || prof > MAX_PROFUNDIDADE || vistos.has(valor)) return false
  vistos.add(valor)

  for (const [chave, filho] of Object.entries(valor)) {
    if (chave === 'quotedMessage') continue
    if (CHAVES_PAGAMENTO.has(chave) && podeVarrer(filho)) return true
    if (temPagamento(filho, prof + 1, vistos)) return true
  }
  return false
}

function mensagemTemPagamento(info) {
  return temPagamento(info?.message)
}

//=============[ ESTADO ]=============\\

const TTL_AUTOR_MS = 60 * 1000
const INTERVALO_LIMPEZA_MS = 30 * 1000
const TTL_INCIDENTE_MS = 8 * 1000

const recentes = new Map() // `${grupo}:${user}` -> expiraEm
const emAndamento = new Map() // `${grupo}:${user}` -> Promise<boolean>
const incidentes = new Map() // grupo -> { pronto, fechou, deveReabrir, reabrindo, timer }

let ultimaLimpeza = 0

const esperar = ms => new Promise(r => setTimeout(r, ms))

function limparRecentes() {
  const agora = Date.now()
  if (agora - ultimaLimpeza < INTERVALO_LIMPEZA_MS) return
  ultimaLimpeza = agora
  for (const [chave, expira] of recentes) if (expira <= agora) recentes.delete(chave)
}

//=============[ ADAPTADORES DA LIB ]=============\\
// Só aqui ficam as chamadas específicas da sua lib. Ajuste se necessário.

// ATENÇÃO: não sei o nome do método de "só admins enviam" na sua lib.
// Procure em ./zapo por "announcement"/"setting" e ajuste. Se não existir,
// retorna false e o bot só remove + apaga (sem fechar o grupo).
async function alterarAnuncio(diablo, from, fechar) {
  const g = diablo.group
  const fn = g?.setAnnouncement || g?.setAnnounce
  if (typeof fn !== 'function') return false
  await fn.call(g, from, fechar)
  return true
}

async function removerMembro(diablo, from, user) {
  try {
    const res = await diablo.group.removeParticipants(from, [user])
    // Se a lib devolver status por participante, só conta 200 como sucesso
    if (Array.isArray(res)) return res.every(r => !r?.status || String(r.status) === '200')
    return true
  } catch (e) {
    console.log('[anti-payment] Erro ao remover membro:', e?.message || e)
    return false
  }
}

async function apagar(diablo, from, info) {
  if (!info) return
  for (let i = 0; i < 2; i++) {
    try {
      await diablo.message.send(from, { type: 'revoke', target: info })
      return
    } catch (e) {
      if (i === 0) await esperar(250)
      else console.log('[anti-payment] Erro ao apagar mensagem:', e?.message || e)
    }
  }
}

//=============[ INCIDENTE DO GRUPO ]=============\\

function obterIncidente(diablo, from, grupoFechado) {
  const atual = incidentes.get(from)
  if (atual && !atual.reabrindo) return atual

  // Se o anterior está reabrindo, quem fechou fomos nós: o novo herda isso.
  const incidente = {
    fechou: false,
    deveReabrir: atual?.reabrindo ? true : !grupoFechado,
    reabrindo: false,
    timer: undefined
  }

  incidente.pronto = (async () => {
    if (!incidente.deveReabrir) return
    try {
      incidente.fechou = await alterarAnuncio(diablo, from, true)
    } catch (e) {
      console.log('[anti-payment] Erro ao fechar o grupo:', e?.message || e)
    }
  })()

  incidentes.set(from, incidente)
  return incidente
}

function agendarReabertura(diablo, from) {
  const incidente = incidentes.get(from)
  if (!incidente) return

  if (!incidente.fechou || !incidente.deveReabrir) {
    incidentes.delete(from)
    return
  }

  if (incidente.timer) clearTimeout(incidente.timer)

  incidente.timer = setTimeout(async () => {
    incidente.reabrindo = true
    try {
      await alterarAnuncio(diablo, from, false)
    } catch (e) {
      console.log('[anti-payment] Erro ao abrir o grupo:', e?.message || e)
    } finally {
      if (incidentes.get(from) === incidente) incidentes.delete(from)
    }
  }, TTL_INCIDENTE_MS)

  incidente.timer.unref?.()
}

//=============[ DEFESA ]=============\\

async function executar({ diablo, from, user, info, grupoFechado }) {
  const incidente = obterIncidente(diablo, from, grupoFechado)
  let removido = false

  try {
    await Promise.all([
      incidente.pronto,
      removerMembro(diablo, from, user).then(ok => { removido = ok }),
      apagar(diablo, from, info)
    ])
  } finally {
    agendarReabertura(diablo, from)
  }

  if (removido) recentes.set(`${from}:${user}`, Date.now() + TTL_AUTOR_MS)
  return removido
}

/**
 * @returns {Promise<boolean>} true se o autor foi (ou já estava sendo) removido.
 * Nunca rejeita.
 */
function defenderContraPagamento(args) {
  const { diablo, from, user, info } = args
  if (!diablo || !from || !user) return Promise.resolve(false)

  limparRecentes()

  const chave = `${from}:${user}`
  const expira = recentes.get(chave)

  // Autor já tratado: ainda apaga a mensagem nova
  if (expira && expira > Date.now()) {
    apagar(diablo, from, info)
    return Promise.resolve(true)
  }

  const existente = emAndamento.get(chave)
  if (existente) {
    apagar(diablo, from, info)
    return existente
  }

  const defesa = executar(args).catch(() => false).finally(() => {
    if (emAndamento.get(chave) === defesa) emAndamento.delete(chave)
  })

  emAndamento.set(chave, defesa)
  return defesa
}

function limparEstado() {
  for (const inc of incidentes.values()) if (inc.timer) clearTimeout(inc.timer)
  recentes.clear()
  emAndamento.clear()
  incidentes.clear()
  ultimaLimpeza = 0
}

module.exports = { mensagemTemPagamento, defenderContraPagamento, limparEstado }
