import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const STATE_FILE = path.join(DATA_DIR, 'state.json')

const defaults = {
  admins: [],      // 管理員（老闆/員工）：可授權、封鎖、切模型、拉群
  allowlist: [],   // 受權名單：可問問題（DM / 群組）
  blocklist: [],   // 黑名單：永久不理
  groups: [],      // 已授權群組
}

let state = load()

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
    }
  } catch (e) {
    console.error('讀取 state.json 失敗', e.message)
  }
  return { ...defaults }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.error('寫入 state.json 失敗', e.message)
  }
}

export const store = {
  get: () => state,
  isAdmin: (phone) => state.admins.includes(phone),
  isBlocked: (phone) => state.blocklist.includes(phone),
  isAllowed: (phone) => state.allowlist.includes(phone),
  // 受權 = 管理員 或 在受權名單內
  isAuthorized: (phone) => state.admins.includes(phone) || state.allowlist.includes(phone),
  isGroupAllowed: (jid) => state.groups.includes(jid),

  addAdmin: (phone) => { if (phone && !state.admins.includes(phone)) { state.admins.push(phone); save() } },
  removeAdmin: (phone) => { state.admins = state.admins.filter((x) => x !== phone); save() },
  addGroup: (jid) => { if (jid && !state.groups.includes(jid)) { state.groups.push(jid); save() } },
  removeGroup: (jid) => { state.groups = state.groups.filter((x) => x !== jid); save() },
  allow: (phone) => { if (phone && !state.allowlist.includes(phone)) { state.allowlist.push(phone); save() } },
  disallow: (phone) => { state.allowlist = state.allowlist.filter((x) => x !== phone); save() },
  block: (phone) => { if (phone && !state.blocklist.includes(phone)) { state.blocklist.push(phone); save() } },
  unblock: (phone) => { state.blocklist = state.blocklist.filter((x) => x !== phone); save() },
}
