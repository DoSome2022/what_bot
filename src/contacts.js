import { normalizePhone, isLid } from './utils.js'

// WhatsApp 新版協議：群組成員用 @lid（Linked ID）識別，
// 這裡維護 lid ↔ 電話號碼 的雙向對應表。
const lidToPhone = new Map() // lid 數字 -> 電話號碼
const phoneToLid = new Map() // 電話號碼 -> lid 數字

export function registerLidPhone(lid, phone) {
  const l = normalizePhone(lid)
  const p = normalizePhone(phone)
  if (l && p) {
    lidToPhone.set(l, p)
    phoneToLid.set(p, l)
  }
}

// 從群組 metadata 的 participants 建立對應（participant 有 id/lid/jid 欄位）
export function registerFromGroupMetadata(metadata) {
  for (const p of metadata?.participants || []) {
    const lid = p.lid || (isLid(p.id) ? p.id : undefined)
    const jid = p.jid || (!isLid(p.id) ? p.id : undefined)
    if (lid && jid) registerLidPhone(lid, jid)
  }
}

export function phoneFromLid(lid) {
  return lidToPhone.get(normalizePhone(lid)) || ''
}

export function lidFromPhone(phone) {
  return phoneToLid.get(normalizePhone(phone)) || ''
}

export function hasLid(lid) {
  return lidToPhone.has(normalizePhone(lid))
}
