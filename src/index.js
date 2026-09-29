import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import config from '../config.js'
import { store } from './store.js'
import { handleMessage, handleGroupUpdate } from './handlers.js'
import { logInfo, logError } from './logger.js'

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('data/auth')
  const sock = makeWASocket({
    auth: state,
    // 關閉無用的初始查詢（fetchProps 等），避免某些網路環境下 60s Timed Out 卡住上線
    fireInitQueries: false,
    // 上線時不自動發送 presence，減少不必要的請求
    markOnlineOnConnect: false,
    // QR 顯示時間（毫秒），從 .env 的 QR_TIMEOUT 讀取，預設 10 分鐘
    qrTimeout: config.qrTimeout,
  })

  // 把 .env 的管理員種子寫入 state（冪等）
  for (const admin of config.admins) store.addAdmin(admin)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    // 自行處理 QR：收到 QR 字串就印到終端機供掃描
    if (qr) {
      qrcode.generate(qr, { small: true })
      console.log('📱 請用手機 WhatsApp → 已連結的裝置 → 掃描上方 QR Code')
    }
    if (connection === 'open') {
      console.log('✅ Bot 已連線，號碼:', sock.user?.id)
      logInfo(`Bot 已連線，號碼: ${sock.user?.id}`)
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.log('⚠️ 連線關閉，code =', statusCode, '，重連 =', shouldReconnect)
      logInfo(`連線關閉，code = ${statusCode}，重連 = ${shouldReconnect}`)
      if (shouldReconnect) {
        setTimeout(start, 3000)
      } else {
        console.log('❌ 已登出，請刪除 data/auth 後重新掃 QR 登入')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue
      console.log('📩 收到訊息 | jid:', msg.key.remoteJid, '| sender:', msg.key.participant || msg.key.remoteJid)
      try {
        await handleMessage(sock, msg)
      } catch (e) {
        console.error('處理訊息失敗:', e)
        logError(`處理訊息失敗: ${e.message}`)
      }
    }
  })

  sock.ev.on('group-participants.update', async (update) => {
    console.log('👥 群組事件:', JSON.stringify(update))
    try {
      await handleGroupUpdate(sock, update)
    } catch (e) {
      console.error('處理群組更新失敗:', e)
      logError(`處理群組更新失敗: ${e.message}`)
    }
  })

  return sock
}

start().catch((e) => {
  console.error('啟動失敗:', e)
  process.exit(1)
})
