const fs = require('fs'), path = require('path'), axios = require('axios')

function numero(jid) {
return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function ids(m) {
return [m?.jid, m?.id, m?.phoneJid, m?.pnJid, m?.lidJid, m?.phoneNumber].filter(Boolean).map(String)
}

function achar(lista, ...jids) {
const alvos = jids.filter(Boolean).map(String), nums = alvos.map(numero).filter(Boolean)
return (lista || []).find(m => ids(m).some(id => alvos.includes(id) || nums.includes(numero(id))))
}

function alvo(m, ref = '') {
const r = String(ref || ''), phone = m?.phoneJid || m?.pnJid || '', lid = m?.lidJid || ''
const raw = m?.phoneNumber ? `${numero(m.phoneNumber)}@s.whatsapp.net` : ''
if(r.includes('@lid')) return phone || raw || (String(m?.jid || '').includes('@s.whatsapp.net') ? m.jid : '') || lid || m?.jid || r
return phone || raw || (String(m?.jid || '').includes('@s.whatsapp.net') ? m.jid : '') || m?.jid || lid || r
}

async function baixar(url) {
const { data } = await axios.get(url, { responseType: 'stream', timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' } })
return data
}

function midia(nome) {
const pasta = path.join(__dirname, '..', 'media')
const arquivos = [
{ type: 'video', data: path.join(pasta, `${nome}.mp4`), mimetype: 'video/mp4' },
{ type: 'image', data: path.join(pasta, `${nome}.png`), mimetype: 'image/png' },
{ type: 'image', data: path.join(pasta, `${nome}.jpg`), mimetype: 'image/jpeg' },
{ type: 'image', data: path.join(pasta, `${nome}.jpeg`), mimetype: 'image/jpeg' }
]
return arquivos.find(v => fs.existsSync(v.data)) || { type: 'text', data: null, mimetype: null }
}

module.exports = { numero, ids, achar, alvo, baixar, midia }
