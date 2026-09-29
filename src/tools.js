import config from '../config.js'

// 把長內容截斷，避免超過 LLM context
function truncate(text, max = 8000) {
  if (!text) return ''
  const t = String(text).trim()
  return t.length > max ? t.slice(0, max) + '\n...(內容過長已截斷)' : t
}

// 1) 網上搜尋文章 — 用 Tavily（需 TAVILY_API_KEY）
export async function searchWeb(query) {
  const key = config.apiKeys.tavily
  if (!key) throw new Error('尚未設定 TAVILY_API_KEY，無法搜尋')
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`搜尋失敗: ${JSON.stringify(data)}`)
  const results = data.results || []
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`)
  if (data.answer) lines.unshift(`摘要答案：${data.answer}`)
  return truncate(lines.join('\n\n'))
}

// 2) YouTube 搜尋 — 用 YouTube Data API v3（需 GOOGLE_API_KEY）
export async function searchYouTube(query) {
  const key = config.apiKeys.google
  if (!key) throw new Error('尚未設定 GOOGLE_API_KEY，無法搜尋 YouTube')
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&type=video&q=${encodeURIComponent(query)}&key=${key}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(`YouTube 搜尋失敗: ${JSON.stringify(data)}`)
  const items = data.items || []
  if (!items.length) return '找不到相關影片。'
  const lines = items.map((it, i) => {
    const id = it.id?.videoId || ''
    const title = it.snippet?.title || ''
    const channel = it.snippet?.channelTitle || ''
    const link = id ? `https://www.youtube.com/watch?v=${id}` : ''
    return `${i + 1}. ${title}\n   頻道：${channel}\n   ${link}`
  })
  return lines.join('\n\n')
}

// 3) 抓取網頁內容（文章 / YouTube 頁面）轉文字 — 用 Jina Reader（免 key）
export async function fetchPage(url) {
  const target = url.startsWith('http') ? url : `https://${url}`
  const res = await fetch(`https://r.jina.ai/${target}`)
  if (!res.ok) throw new Error(`抓取失敗: ${res.status}`)
  const text = await res.text()
  return truncate(text, 12000)
}
