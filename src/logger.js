import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.resolve(__dirname, '../data/logs')

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

// 取今天的 log 檔名，例如 2026-09-28.log
function todayFile() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return path.join(LOG_DIR, `${y}-${m}-${day}.log`)
}

function timestamp() {
  return new Date().toISOString()
}

function write(line) {
  try {
    ensureDir()
    fs.appendFileSync(todayFile(), line + '\n', 'utf8')
  } catch (e) {
    console.error('寫入 log 失敗:', e.message)
  }
}

// 一般事件
export function logInfo(msg) {
  write(`[${timestamp()}] [INFO] ${msg}`)
}

// 錯誤
export function logError(msg) {
  write(`[${timestamp()}] [ERROR] ${msg}`)
}

// 記錄對話：角色 in=使用者提問 / out=bot 回覆
export function logMessage({ jid, sender, role, text }) {
  const who = role === 'in' ? 'USER' : 'BOT'
  const from = role === 'in' ? `來自 ${sender}` : `回覆 ${jid}`
  write(`[${timestamp()}] [${who}] ${from} | ${text}`)
}
