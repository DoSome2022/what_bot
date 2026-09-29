export function normalizePhone(jid) {
  if (!jid) return ''
  return jid.replace(/@.*$/, '').split(':')[0]
}

// WhatsApp 新版協議：群組成員可能用 Linked ID（@lid）而非電話號碼識別
export function isLid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid')
}

export function isGroup(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}

export function getText(msg) {
  const m = msg.message || {}
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  )
}

export function getMentionedJids(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
}
