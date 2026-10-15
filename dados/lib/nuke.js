// Palavras que o anti-nuke trata como "comando de nuke" (edite a lista se quiser)
const PALAVRAS = ['nuke', 'nukar', 'kickall', 'banall', 'removeall']

// Só conta se a palavra estiver no INÍCIO da mensagem, com até 2 símbolos de prefixo (!nuke, #nuke, .nuke, /nuke, nuke)
const REGEX = new RegExp(`^\\s*[^\\w\\s]{0,2}\\s?(${PALAVRAS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')

function ehComandoNuke(texto) {
return REGEX.test(String(texto || ''))
}

const esperar = ms => new Promise(r => setTimeout(r, ms))

/**
 * Remove participantes em lotes. Se um lote falhar, tenta um a um.
 * removerFn(lista) deve lançar erro se falhar. Retorna { removidos, falhas }.
 */
async function removerEmLotes(removerFn, jids, tamanho = 20, espera = 800) {
let removidos = 0, falhas = 0
for(let i = 0; i < jids.length; i += tamanho) {
const lote = jids.slice(i, i + tamanho)
try {
await removerFn(lote)
removidos += lote.length
} catch {
for(const j of lote) {
try { await removerFn([j]); removidos++ } catch { falhas++ }
}
}
if(i + tamanho < jids.length) await esperar(espera)
}
return { removidos, falhas }
}

module.exports = { ehComandoNuke, removerEmLotes, PALAVRAS }
