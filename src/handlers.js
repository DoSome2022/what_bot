import config from '../config.js'
import { store } from './store.js'
import { normalizePhone, isGroup, getText, getMentionedJids, isLid } from './utils.js'
import { registerFromGroupMetadata, phoneFromLid } from './contacts.js'
import { chat, getHistory, pushHistory, clearHistory, AVAILABLE_PROVIDERS } from './llm.js'
import { searchWeb, searchYouTube, fetchPage } from './tools.js'
import { logInfo, logError, logMessage } from './logger.js'

// 把 jid（可能是 @lid 或電話號碼）對應回電話號碼；若還沒對應就回傳原始數字
function resolvePhone(jid) {
  if (isLid(jid)) return phoneFromLid(jid) || normalizePhone(jid)
  return normalizePhone(jid)
}

// 群組內：先抓 metadata 建立 lid↔電話 對應，再解析成員電話
async function resolveGroupSender(sock, jid, rawJid) {
  if (!isLid(rawJid)) return normalizePhone(rawJid)
  const cached = phoneFromLid(rawJid)
  if (cached) return cached
  try {
    const meta = await sock.groupMetadata(jid)
    registerFromGroupMetadata(meta)
  } catch (e) {
    console.error('抓取群組 metadata 失敗:', e.message)
  }
  return phoneFromLid(rawJid) || normalizePhone(rawJid)
}

export async function handleGroupUpdate(sock, update) {
  const botJid = sock.user?.id
  const botLid = sock.user?.lid
  if (!botJid) return
  const { id, participants, action, author } = update
  if (action !== 'add') return

  const botAdded = participants.some(
    (p) => normalizePhone(p) === normalizePhone(botJid) || (botLid && normalizePhone(p) === normalizePhone(botLid)),
  )
  if (!botAdded) return

  const authorPhone = await resolveGroupSender(sock, id, author)
  if (store.isAdmin(authorPhone)) {
    store.addGroup(id)
    const hint = config.triggerPassphrase
      ? `@我、用「${config.triggerSymbol}」前綴，或說暗號`
      : `@我 或用「${config.triggerSymbol}」前綴`
    await sock.sendMessage(id, { text: `🤖 已加入。在群內 ${hint} 提問即可。` })
  } else {
    await sock.sendMessage(id, { text: '⛔ 你沒有權限將我加入此群，我即將退出。' })
    await sock.groupLeave(id)
  }
}

export async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid
  const rawSender = msg.key.participant || msg.key.remoteJid
  const group = isGroup(jid)
  const sender = group ? await resolveGroupSender(sock, jid, rawSender) : resolvePhone(rawSender)
  const text = getText(msg).trim()
  if (!text || !jid) return

  // 記錄收到訊息
  logMessage({ jid, sender, role: 'in', text })

  const isAdmin = store.isAdmin(sender)

  // 管理指令（僅管理員）
  if (text.startsWith('/') && isAdmin) {
    return handleCommand(sock, jid, sender, text, group)
  }

  // 黑名單優先
  if (store.isBlocked(sender)) return

  // 未受權一概不理（DM 與群組都擋）
  if (!store.isAuthorized(sender)) return

  // 群組：需授權群 + 觸發
  if (group) {
    if (!store.isGroupAllowed(jid)) return
    const mentioned = getMentionedJids(msg).some(
      (p) => normalizePhone(p) === normalizePhone(sock.user.id) || (sock.user.lid && normalizePhone(p) === normalizePhone(sock.user.lid)),
    )
    const hitSymbol = config.triggerSymbol && text.startsWith(config.triggerSymbol)
    const hitPass = config.triggerPassphrase && text.includes(config.triggerPassphrase)
    if (!mentioned && !hitSymbol && !hitPass) return
  }

  const clean = text.startsWith(config.triggerSymbol) ? text.slice(config.triggerSymbol.length).trim() : text
  if (!clean) return

  await sock.sendPresenceUpdate('composing', jid)
  try {
    // 工具指令：搜尋 / 影片 / 分析
    const toolReply = await handleToolCommand(sock, jid, clean)
    if (toolReply !== null) {
      logMessage({ jid, sender, role: 'out', text: toolReply })
      await sock.sendMessage(jid, { text: toolReply })
      return
    }

    // 自動聯網：偵測時間敏感問題，自動搜尋最新資料（需 TAVILY_API_KEY）
    if (config.autoSearch && isTimeSensitive(clean) && config.apiKeys.tavily) {
      const autoReply = await autoSearchAndAnswer(clean)
      if (autoReply) {
        pushHistory(jid, 'user', clean)
        pushHistory(jid, 'assistant', autoReply)
        logMessage({ jid, sender, role: 'out', text: autoReply })
        await sock.sendMessage(jid, { text: autoReply })
        return
      }
    }

    const reply = await chat(
      config.llmProvider,
      config.llmModel,
      config.systemPrompt,
      [...getHistory(jid), { role: 'user', content: clean }],
    )
    pushHistory(jid, 'user', clean)
    pushHistory(jid, 'assistant', reply)
    logMessage({ jid, sender, role: 'out', text: reply })
    await sock.sendMessage(jid, { text: reply })
  } catch (e) {
    console.error('LLM 錯誤:', e.message)
    logError(`LLM 錯誤: ${e.message}`)
    await sock.sendMessage(jid, { text: '⚠️ 暫時無法回答，請稍後再試。' })
  } finally {
    await sock.sendPresenceUpdate('paused', jid)
  }
}

// 時間敏感關鍵字：命中就自動搜尋最新資料
const TIME_SENSITIVE_KEYWORDS = [
  '最新', '今天', '今日', '現在', '目前', '近日', '本週', '本周', '剛剛',
  '新聞', '時事', '即時', '熱門', '趨勢', '股價', '股市', '匯率', '比特幣',
  '價格', '價錢', '多少錢', '天氣', '台風', '颱風', '地震',
  '2026', '2025', '今天', '上市', '發布', '推出', '開賣',
]

function isTimeSensitive(text) {
  return TIME_SENSITIVE_KEYWORDS.some((k) => text.includes(k))
}

async function autoSearchAndAnswer(query) {
  try {
    const raw = await searchWeb(query)
    const reply = await chat(
      config.llmProvider,
      config.llmModel,
      '你是即時資訊助理。根據提供的「最新搜尋結果」用繁體中文回答，並適時標注資料來源。若結果不足，誠實說明。',
      [{ role: 'user', content: `問題：${query}\n\n最新搜尋結果：\n${raw}\n\n請回答。` }],
    )
    return reply
  } catch (e) {
    logError(`自動搜尋失敗: ${e.message}`)
    return ''
  }
}

async function handleToolCommand(sock, jid, clean) {
  // 用前綴辨識工具；格式：!搜尋 關鍵字 / !影片 關鍵字 / !分析 網址
  const prefixes = [
    { keys: ['搜尋', '搜索', 'search'], tool: 'search' },
    { keys: ['影片', 'youtube', 'yt', '視頻'], tool: 'youtube' },
    { keys: ['分析', 'analyze', '摘要', 'summarize'], tool: 'analyze' },
  ]

  let matched = null
  for (const p of prefixes) {
    for (const k of p.keys) {
      if (clean === k || clean.startsWith(k + ' ') || clean.startsWith(k + '：') || clean.startsWith(k + ':')) {
        matched = p.tool
        break
      }
    }
    if (matched) break
  }
  if (!matched) return null

  // 去掉前綴，取出參數
  let arg = clean
  for (const p of prefixes) {
    if (p.tool !== matched) continue
    for (const k of p.keys) {
      if (clean === k) { arg = ''; break }
      if (clean.startsWith(k + ' ')) { arg = clean.slice(k.length).trim(); break }
      if (clean.startsWith(k + '：')) { arg = clean.slice(k.length + 1).trim(); break }
      if (clean.startsWith(k + ':')) { arg = clean.slice(k.length + 1).trim(); break }
    }
    if (arg !== clean) break
  }

  if (!arg) {
    if (matched === 'search') return '用法：!搜尋 <關鍵字>\n範例：!搜尋 今日科技新聞'
    if (matched === 'youtube') return '用法：!影片 <關鍵字>\n範例：!影片 node.js 教學'
    if (matched === 'analyze') return '用法：!分析 <網址>\n範例：!分析 https://example.com/article'
  }

  try {
    if (matched === 'search') {
      const raw = await searchWeb(arg)
      const reply = await chat(
        config.llmProvider,
        config.llmModel,
        '你是研究助理，根據提供的搜尋結果，用繁體中文整理出重點與結論。如果結果不足，誠實說明。',
        [{ role: 'user', content: `搜尋主題：${arg}\n\n搜尋結果：\n${raw}\n\n請整理重點。` }],
      )
      return reply
    }
    if (matched === 'youtube') {
      const raw = await searchYouTube(arg)
      return raw
    }
    if (matched === 'analyze') {
      const raw = await fetchPage(arg)
      const reply = await chat(
        config.llmProvider,
        config.llmModel,
        '你是內容分析助理，用繁體中文摘要並分析提供的內容，條列重點。',
        [{ role: 'user', content: `網址：${arg}\n\n內容：\n${raw}\n\n請分析。` }],
      )
      return reply
    }
  } catch (e) {
    logError(`工具執行失敗: ${e.message}`)
    return `⚠️ 工具執行失敗：${e.message}`
  }
  return null
}

async function handleCommand(sock, jid, sender, text, group) {
  const [cmd, ...rest] = text.split(/\s+/)
  const arg = rest.join(' ').trim()
  const digits = arg.replace(/\D/g, '')
  const reply = (t) => sock.sendMessage(jid, { text: t })

  switch (cmd.toLowerCase()) {
    case '/help':
      return reply(helpText())
    case '/admin':
      if (!digits) return reply('用法：/admin <電話號碼>')
      store.addAdmin(digits)
      return reply(`✅ 已將 ${digits} 設為管理員`)
    case '/unadmin':
      if (!digits) return reply('用法：/unadmin <電話號碼>')
      // .env 設定的種子管理員不可移除，避免把自己也移掉
      if (config.admins.includes(digits)) return reply('⛔ 此號碼是 .env 設定的管理員，不可移除。')
      store.removeAdmin(digits)
      return reply(`✅ 已移除 ${digits} 的管理員權限`)
    case '/allow':
      if (!digits) return reply('用法：/allow <電話號碼>')
      store.allow(digits)
      return reply(`✅ 已授權 ${digits}（可問問題）`)
    case '/remove':
      if (!digits) return reply('用法：/remove <電話號碼>')
      store.disallow(digits)
      return reply(`✅ 已移除 ${digits} 的授權`)
    case '/ban':
      if (!digits) return reply('用法：/ban <電話號碼>')
      store.block(digits)
      return reply(`✅ 已封鎖 ${digits}`)
    case '/unban':
      if (!digits) return reply('用法：/unban <電話號碼>')
      store.unblock(digits)
      return reply(`✅ 已解除封鎖 ${digits}`)
    case '/ungroup':
      if (!group) return reply('此指令只在群組內使用')
      store.removeGroup(jid)
      return reply('✅ 已移除此群組的授權，之後需重新授權才能提問')
    case '/model':
      if (!arg) return reply(`目前 provider：${config.llmProvider}（model：${config.llmModel || '預設'}）\n可用：${AVAILABLE_PROVIDERS.join(' / ')}`)
      if (!AVAILABLE_PROVIDERS.includes(arg)) return reply(`未知 provider，可用：${AVAILABLE_PROVIDERS.join(' / ')}`)
      config.llmProvider = arg
      config.llmModel = ''
      return reply(`✅ 已切換到 ${arg}`)
    case '/clear':
      clearHistory(jid)
      return reply('✅ 已清除本對話的記憶')
    case '/leave':
      if (group) {
        await sock.groupLeave(jid)
        return
      }
      return reply('此指令只在群組內有效')
    case '/addgroup':
      if (!group) return reply('此指令只在群組內使用')
      store.addGroup(jid)
      return reply('✅ 已授權此群組，群內成員可用「!」前綴或 @我 提問')
    case '/myid':
      return reply(`你的號碼（bot 看到）：${sender}`)
    case '/list': {
      const s = store.get()
      return reply(
        `📋 管理員：${s.admins.join(', ') || '無'}\n` +
        `受權名單：${s.allowlist.join(', ') || '無'}\n` +
        `黑名單：${s.blocklist.join(', ') || '無'}\n` +
        `已授權群組：${s.groups.join(', ') || '無'}`,
      )
    }
    default:
      return reply('未知指令，輸入 /help 查看')
  }
}

function helpText() {
  return `🤖 管理員指令：
/admin <號碼>  設為管理員
/unadmin <號碼> 移除管理員權限
/allow <號碼>  授權可問問題
/remove <號碼> 移除授權
/ban <號碼>    封鎖
/unban <號碼>  解除封鎖
/model <名稱>  切換 AI（${AVAILABLE_PROVIDERS.join('/')}）
/list          查看名單與總對話數
/clear         清除本對話記憶
/addgroup      授權當前群組（群內使用）
/ungroup       移除當前群組授權（群內使用）
/myid          查看 bot 看到你的號碼
/leave         退出本群
/help          本說明

📡 工具指令（群組/私訊，受權用戶）：
!搜尋 <關鍵字>  網上搜尋文章（需 TAVILY_API_KEY）
!影片 <關鍵字>  搜尋 YouTube 影片（需 GOOGLE_API_KEY）
!分析 <網址>    抓取文章/影片內容並分析（免 key）`
}
