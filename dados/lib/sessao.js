const fs = require('fs'), path = require('path'), v8 = require('v8')

function chave(a) {
const server = a?.server || 's.whatsapp.net'
return `${a?.user || ''}|${server}|${Number(a?.device || 0)}`
}

function hex(b) {
return Buffer.from(b || []).toString('hex')
}

function igual(a, b) {
const x = Buffer.from(a || []), y = Buffer.from(b || [])
return x.length === y.length && x.equals(y)
}

function disco(file, padrao) {
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })

let data = padrao()
if(fs.existsSync(file)) {
try { data = v8.deserialize(fs.readFileSync(file)) }
catch(e) {
try { fs.renameSync(file, `${file}.corrompido-${Date.now()}`) } catch {}
console.log(`[ SESSÃO ] Arquivo inválido recriado: ${path.basename(file)}`)
}
}

function salvar() {
const tmp = `${file}.tmp-${process.pid}`
fs.writeFileSync(tmp, v8.serialize(data), { mode: 0o600 })
fs.renameSync(tmp, file)
try { fs.chmodSync(file, 0o600) } catch {}
}

function limpar() {
data = padrao()
try { fs.rmSync(file, { force: true }) } catch {}
}

return { get: () => data, set: v => { data = v }, salvar, limpar }
}

function auth(file) {
const d = disco(file, () => ({ valor: null }))
return {
async load() { return d.get().valor },
async save(valor) { d.get().valor = valor; d.salvar() },
async clear() { d.limpar() }
}
}

function signal(file) {
const d = disco(file, () => ({ registro: null, signed: null, rotation: null }))
return {
async getRegistrationInfo() { return d.get().registro },
async setRegistrationInfo(info) { d.get().registro = info; d.salvar() },
async getSignedPreKey() { return d.get().signed },
async setSignedPreKey(record) { d.get().signed = record; d.salvar() },
async getSignedPreKeyById(id) { const r = d.get().signed; return r?.keyId === id ? r : null },
async setSignedPreKeyRotationTs(value) { d.get().rotation = value; d.salvar() },
async getSignedPreKeyRotationTs() { return d.get().rotation },
async clear() { d.limpar() }
}
}

function prekey(file) {
const d = disco(file, () => ({ keys: new Map(), uploaded: new Set(), server: false, next: 1 }))

function estado() {
const s = d.get()
if(!(s.keys instanceof Map)) s.keys = new Map(s.keys || [])
if(!(s.uploaded instanceof Set)) s.uploaded = new Set(s.uploaded || [])
if(!Number.isSafeInteger(s.next) || s.next < 1) s.next = 1
return s
}

return {
async putPreKey(record) {
const s = estado(); s.keys.set(record.keyId, record)
if(record.keyId >= s.next) s.next = record.keyId + 1
d.salvar()
},
async getOrGenPreKeys(count, generator) {
if(!Number.isSafeInteger(count) || count <= 0) throw new Error(`invalid prekey count: ${count}`)
const s = estado(), out = [], ids = [...s.keys.keys()].filter(id => !s.uploaded.has(id)).sort((a, b) => a - b)
for(const id of ids) { const r = s.keys.get(id); if(r) out.push(r); if(out.length >= count) return out }
while(out.length < count) { const r = await generator(s.next++); s.keys.set(r.keyId, r); out.push(r) }
d.salvar(); return out
},
async getPreKeyById(id) { return estado().keys.get(id) || null },
async getPreKeysById(ids) { const s = estado(); return ids.map(id => s.keys.get(id) || null) },
async consumePreKeyById(id) {
const s = estado(), r = s.keys.get(id) || null
if(!r) return null
s.keys.delete(id); s.uploaded.delete(id); d.salvar(); return r
},
async getOrGenSinglePreKey(generator) { return (await this.getOrGenPreKeys(1, generator))[0] },
async markKeyAsUploaded(id) {
const s = estado()
if(id < 0 || id >= s.next) throw new Error(`prekey ${id} is out of boundary`)
for(const k of s.keys.keys()) if(k <= id) s.uploaded.add(k)
d.salvar()
},
async setServerHasPreKeys(value) { estado().server = !!value; d.salvar() },
async getServerHasPreKeys() { return !!estado().server },
async clear() { d.limpar() }
}
}

function session(file) {
const d = disco(file, () => ({ map: new Map() }))
const map = () => { const s = d.get(); if(!(s.map instanceof Map)) s.map = new Map(s.map || []); return s.map }
return {
async hasSession(a) { return map().has(chave(a)) },
async hasSessions(lista) { const m = map(); return lista.map(a => m.has(chave(a))) },
async getSession(a) { return map().get(chave(a)) || null },
async getSessionsBatch(lista) { const m = map(); return lista.map(a => m.get(chave(a)) || null) },
async setSession(a, valor) { map().set(chave(a), valor); d.salvar() },
async setSessionsBatch(lista) { const m = map(); for(const e of lista) m.set(chave(e.address), e.session); d.salvar() },
async deleteSession(a) { map().delete(chave(a)); d.salvar() },
async clear() { d.limpar() }
}
}

function identity(file) {
const d = disco(file, () => ({ map: new Map() }))
const map = () => { const s = d.get(); if(!(s.map instanceof Map)) s.map = new Map(s.map || []); return s.map }
return {
async getRemoteIdentity(a) { return map().get(chave(a)) || null },
async getRemoteIdentities(lista) { const m = map(); return lista.map(a => m.get(chave(a)) || null) },
async setRemoteIdentity(a, valor) { map().set(chave(a), valor); d.salvar() },
async setRemoteIdentities(lista) { const m = map(); for(const e of lista) m.set(chave(e.address), e.identityKey); d.salvar() },
async clear() { d.limpar() }
}
}

function senderkey(file) {
const d = disco(file, () => ({ keys: new Map(), dist: new Map() }))

function estado() {
const s = d.get()
if(!(s.keys instanceof Map)) s.keys = new Map(s.keys || [])
if(!(s.dist instanceof Map)) s.dist = new Map(s.dist || [])
return s
}

const id = (grupo, sender) => `${grupo}|${chave(sender)}`
const apagar = (map, target, grupo) => {
let total = 0, alvo = chave(target)
for(const [k, r] of map.entries()) if((!grupo || r.groupId === grupo) && chave(r.sender) === alvo) { map.delete(k); total++ }
return total
}

return {
async upsertSenderKey(record) { estado().keys.set(id(record.groupId, record.sender), record); d.salvar() },
async upsertSenderKeyDistribution(record) { estado().dist.set(id(record.groupId, record.sender), record); d.salvar() },
async upsertSenderKeyDistributions(records) { const s = estado(); for(const r of records) s.dist.set(id(r.groupId, r.sender), r); d.salvar() },
async getGroupSenderKeyList(groupId) {
const s = estado(), skList = [], skDistribList = []
for(const r of s.keys.values()) if(r.groupId === groupId) skList.push(r)
for(const r of s.dist.values()) if(r.groupId === groupId) skDistribList.push(r)
return { skList, skDistribList }
},
async getDeviceSenderKey(groupId, sender) { return estado().keys.get(id(groupId, sender)) || null },
async getDeviceSenderKeyDistributions(groupId, senders) { const s = estado(); return senders.map(a => s.dist.get(id(groupId, a)) || null) },
async deleteDeviceSenderKey(target, groupId) {
const s = estado(), n = apagar(s.keys, target, groupId) + apagar(s.dist, target, groupId)
if(n) d.salvar(); return n
},
async markForgetSenderKey(groupId, participants) {
const s = estado(); let n = 0
for(const p of participants) n += apagar(s.keys, p, groupId) + apagar(s.dist, p, groupId)
if(n) d.salvar(); return n
},
async clear() { d.limpar() }
}
}

function appstate(file) {
const d = disco(file, () => ({ keys: new Map(), collections: new Map() }))

function estado() {
const s = d.get()
if(!(s.keys instanceof Map)) s.keys = new Map(s.keys || [])
if(!(s.collections instanceof Map)) s.collections = new Map(s.collections || [])
return s
}

function colecao(nome) {
const s = estado(); let c = s.collections.get(nome)
if(!c) { c = { initialized: false, version: 0, hash: new Uint8Array(128), indexValueMap: new Map() }; s.collections.set(nome, c) }
if(!(c.indexValueMap instanceof Map)) c.indexValueMap = new Map(c.indexValueMap || [])
return c
}

function epoch(id) { return id?.byteLength < 6 ? -1 : id[2] * 16777216 + id[3] * 65536 + id[4] * 256 + id[5] }
function device(id) { return id?.byteLength < 6 ? null : (id[0] << 8) | id[1] }
function ativa(keys) {
let atual = null
for(const key of keys) {
if(!atual) { atual = key; continue }
const a = epoch(atual.keyId), b = epoch(key.keyId)
if(b > a || (b === a && device(key.keyId) !== null && device(atual.keyId) !== null && device(key.keyId) < device(atual.keyId))) atual = key
}
return atual
}

return {
async exportData() {
const s = estado(), collections = {}
for(const [nome, c] of s.collections.entries()) collections[nome] = { version: c.version, hash: c.hash, indexValueMap: Object.fromEntries(c.indexValueMap.entries()) }
return { keys: [...s.keys.values()], collections }
},
async upsertSyncKeys(keys) {
const s = estado(); let n = 0
for(const key of keys) { const k = hex(key.keyId), old = s.keys.get(k); if(old && igual(old.keyData, key.keyData)) continue; s.keys.set(k, key); n++ }
if(n) d.salvar(); return n
},
async getSyncKeysBatch(ids) { const s = estado(); return ids.map(id => s.keys.get(hex(id)) || null) },
async getSyncKeyData(id) { return estado().keys.get(hex(id))?.keyData || null },
async getSyncKeyDataBatch(ids) { const s = estado(); return ids.map(id => s.keys.get(hex(id))?.keyData || null) },
async getActiveSyncKey() { return ativa(estado().keys.values()) },
async getCollectionState(nome) { return colecao(nome) },
async getCollectionStates(nomes) { return nomes.map(nome => colecao(nome)) },
async setCollectionStates(updates) {
const s = estado()
for(const u of updates) s.collections.set(u.collection, { initialized: true, version: u.version, hash: u.hash, indexValueMap: new Map(u.indexValueMap.entries()) })
d.salvar()
},
async clear() { d.limpar() }
}
}

function privacy(file) {
const d = disco(file, () => ({ map: new Map() }))
const map = () => { const s = d.get(); if(!(s.map instanceof Map)) s.map = new Map(s.map || []); return s.map }
const juntar = (a, b) => ({ jid: b.jid, tcToken: b.tcToken ?? a.tcToken, tcTokenTimestamp: b.tcTokenTimestamp ?? a.tcTokenTimestamp, tcTokenSenderTimestamp: b.tcTokenSenderTimestamp ?? a.tcTokenSenderTimestamp, nctSalt: b.nctSalt ?? a.nctSalt, updatedAtMs: b.updatedAtMs })
return {
async upsert(r) { const m = map(), old = m.get(r.jid); m.set(r.jid, old ? juntar(old, r) : r); d.salvar() },
async upsertBatch(lista) { const m = map(); for(const r of lista) { const old = m.get(r.jid); m.set(r.jid, old ? juntar(old, r) : r) } d.salvar() },
async getByJid(jid) { return map().get(jid) || null },
async deleteByJid(jid) { const ok = map().delete(jid); if(ok) d.salvar(); return ok ? 1 : 0 },
async clear() { d.limpar() },
async destroy() {}
}
}

function sessao(pasta) {
const raiz = path.resolve(pasta)
const file = (id, nome) => {
const safe = String(id || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_')
return path.join(raiz, safe, nome)
}

return {
stores: {
auth: id => auth(file(id, 'auth.bin')),
signal: id => signal(file(id, 'signal.bin')),
preKey: id => prekey(file(id, 'prekey.bin')),
session: id => session(file(id, 'session.bin')),
identity: id => identity(file(id, 'identity.bin')),
senderKey: id => senderkey(file(id, 'senderkey.bin')),
appState: id => appstate(file(id, 'appstate.bin')),
privacyToken: id => privacy(file(id, 'privacy.bin'))
},
caches: {}
}
}

module.exports = { sessao }
