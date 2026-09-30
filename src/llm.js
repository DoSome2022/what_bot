import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../config.js'
import { logLlm, logError } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HISTORY_DIR = path.resolve(__dirname, '../data/history')
const HISTORY_LIMIT = 60 // 每個對話最多保留 60 條訊息（約 30 輪來回）

const PROVIDERS = {
  deepseek: {
    type: 'openai',
    url: 'https://api.deepseek.com/chat/completions',
    key: () => config.apiKeys.deepseek,
    defaultModel: 'deepseek-v4-flash',
  },
  openai: {
    type: 'openai',
    url: config.openaiBaseUrl || 'https://api.openai.com/v1/chat/completions',
    key: () => config.apiKeys.openai,
    defaultModel: 'gpt-4o-mini',
  },
  google: {
    type: 'google',
    key: () => config.apiKeys.google,
    defaultModel: 'gemini-2.5-flash',
  },
  anthropic: {
    type: 'anthropic',
    url: config.anthropicBaseUrl || 'https://api.anthropic.com/v1/messages',
    key: () => config.apiKeys.anthropic,
    defaultModel: 'claude-haiku-4-5',
  },
  // ↓ 連接 Claude Code（claude/start.sh）正在使用的 DeepSeek / Kimi 模型後端
  'deepseek-anthropic': {
    type: 'anthropic',
    url: 'https://api.deepseek.com/anthropic/v1/messages',
    key: () => config.apiKeys.deepseekAnthropic || config.apiKeys.deepseek,
    defaultModel: 'deepseek-v4-pro[1m]',
  },
  kimi: {
    type: 'anthropic',
    url: 'https://api.moonshot.ai/anthropic/v1/messages',
    key: () => config.apiKeys.kimi,
    defaultModel: 'kimi-k3[1m]',
  },
}

export const AVAILABLE_PROVIDERS = Object.keys(PROVIDERS)

async function openaiCompat({ url, apiKey, model, system, history }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...history],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`OpenAI 兼容 API 錯誤: ${JSON.stringify(data)}`)
  const text = data.choices?.[0]?.message?.content || ''
  const u = data.usage
  const tokens = u ? `in=${u.prompt_tokens} out=${u.completion_tokens}` : ''
  return { text, tokens }
}

async function anthropicChat({ url, apiKey, model, system, history }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Anthropic 錯誤: ${JSON.stringify(data)}`)
  // DeepSeek/Kimi 的 Anthropic 端點會先回 thinking 區塊，需抓 type === 'text' 的內容
  const textBlocks = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '')
  const text = textBlocks.join('').trim() || ''
  const u = data.usage
  const tokens = u ? `in=${u.input_tokens} out=${u.output_tokens}` : ''
  return { text, tokens }
}

async function googleChat({ apiKey, model, system, history }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google 錯誤: ${JSON.stringify(data)}`)
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const u = data.usageMetadata
  const tokens = u ? `in=${u.promptTokenCount} out=${u.candidatesTokenCount}` : ''
  return { text, tokens }
}

export async function chat(provider, model, system, history) {
  const p = PROVIDERS[provider]
  const m = model || p?.defaultModel || ''
  const start = Date.now()
  try {
    if (!p) throw new Error(`未知 provider: ${provider}`)
    const apiKey = p.key()
    if (!apiKey) throw new Error(`缺少 ${provider} 的 API key`)

    let result
    if (p.type === 'openai') result = await openaiCompat({ url: p.url, apiKey, model: m, system, history })
    else if (p.type === 'anthropic') result = await anthropicChat({ url: p.url, apiKey, model: m, system, history })
    else if (p.type === 'google') result = await googleChat({ apiKey, model: m, system, history })
    else throw new Error('未知 provider 類型')

    logLlm({ provider, model: m, ms: Date.now() - start, tokens: result.tokens })
    return result.text
  } catch (e) {
    logLlm({ provider, model: m, ms: Date.now() - start, error: e.message })
    throw e
  }
}

// ---- 對話記憶（持久化到 data/history/，重啟後仍記得上文下理）----
function historyFile(jid) {
  const safe = jid.replace(/[^a-zA-Z0-9@._-]/g, '_')
  return path.join(HISTORY_DIR, `${safe}.json`)
}

function loadHistory(jid) {
  try {
    if (fs.existsSync(historyFile(jid))) {
      const arr = JSON.parse(fs.readFileSync(historyFile(jid), 'utf8'))
      if (Array.isArray(arr)) return arr.slice(-HISTORY_LIMIT)
    }
  } catch (e) {
    logError(`讀取對話記憶失敗 (${jid}): ${e.message}`)
  }
  return []
}

function saveHistory(jid, arr) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true })
    fs.writeFileSync(historyFile(jid), JSON.stringify(arr.slice(-HISTORY_LIMIT), null, 2))
  } catch (e) {
    logError(`寫入對話記憶失敗 (${jid}): ${e.message}`)
  }
}

export function getHistory(jid) {
  return loadHistory(jid)
}

export function pushHistory(jid, role, content) {
  const h = loadHistory(jid)
  h.push({ role, content })
  saveHistory(jid, h)
}

export function clearHistory(jid) {
  try {
    if (fs.existsSync(historyFile(jid))) fs.unlinkSync(historyFile(jid))
  } catch (e) {
    logError(`清除對話記憶失敗 (${jid}): ${e.message}`)
  }
}
