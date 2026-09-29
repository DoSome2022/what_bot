# WhatsApp AI 同事 — 使用與維護手冊

> 本文件記錄專案的使用方法、架構，以及每次修正的位置，作為日後修改與擴展的參考。
> 最後更新：2026-09-29

---

## 目錄

1. [專案簡介](#1-專案簡介)
2. [目錄結構與檔案職責](#2-目錄結構與檔案職責)
3. [環境設定（.env）](#3-環境設定env)
4. [安裝與啟動](#4-安裝與啟動)
5. [使用指令總表](#5-使用指令總表)
6. [權限模型](#6-權限模型)
7. [修正紀錄（每個改動的位置）](#7-修正紀錄每個改動的位置)
8. [擴展指引](#8-擴展指引)
9. [資料位置與備份](#9-資料位置與備份)
10. [海外 VPS 部署（規劃中）](#10-海外-vps-部署規劃中)

---

## 1. 專案簡介

這是一個 WhatsApp 群組問答 Bot，功能：

- 多個 LLM 一鍵切換（DeepSeek / OpenAI / Gemini / Anthropic / Kimi）
- 封閉式權限控管（管理員 / 受權名單 / 黑名單 / 群組授權）
- 群組內需「@提及 / 符號前綴 / 暗號」才回應
- 對話有上下文記憶，且**持久化到磁碟**（重啟不丟）
- 管理員指令（授權、封鎖、切模型、查名單等）
- 對話與事件寫入 log 檔（按日期分檔）
- Docker 部署 + 斷線自動重連

技術棧：Node.js（ESM）、`@whiskeysockets/baileys`（WhatsApp 多裝置）、`qrcode-terminal`、原生 `fetch` 呼叫各家 LLM API。

---

## 2. 目錄結構與檔案職責

```
whatsapp-multi-llm-bot/
├── .env                  # 實際設定（含 API key，勿外流）
├── .env.example          # 設定範本
├── config.js             # 讀取 .env，集中管理設定
├── package.json          # 依賴與啟動腳本（npm start）
├── Dockerfile
├── docker-compose.yml
├── README.md
├── src/
│   ├── index.js          # 入口：建立 socket、監聽事件、QR 登入、連線管理
│   ├── handlers.js       # 訊息與群組事件處理、管理指令
│   ├── llm.js            # 呼叫各家 LLM API、對話記憶（持久化）
│   ├── store.js          # 權限狀態的讀寫（data/state.json）
│   ├── contacts.js       # lid ↔ 電話號碼 對應表（WhatsApp 新版協議）
│   ├── tools.js          # 工具：網上搜尋（Tavily）、YouTube、網頁抓取（Jina）
│   ├── utils.js          # 工具函式（normalizePhone、isGroup、isLid、getText 等）
│   └── logger.js         # log 寫檔（data/logs/，按日期分檔）
└── data/                 # 執行時產生的資料（需備份）
    ├── auth/             # WhatsApp 登入憑證（洩漏=帳號被劫持）
    ├── state.json        # 管理員/受權/黑名單/群組
    ├── history/          # 每個對話的上下文記憶（持久化）
    └── logs/             # 對話與事件 log
```

---

## 3. 環境設定（.env）

| 欄位 | 說明 | 範例 |
|---|---|---|
| `ADMIN_PHONES` | **種子管理員**（國碼+號碼，逗號分隔），不可被 `/unadmin` 移除 | `85291234567,85298765432` |
| `TRIGGER_SYMBOL` | 群組觸發符號（訊息前綴） | `!` |
| `TRIGGER_PASSPHRASE` | 群組觸發暗號（內含即觸發） | 留空=不用 |
| `LLM_PROVIDER` | 預設模型 provider | `openai` |
| `LLM_MODEL` | 指定模型名（留空用預設） | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | OpenAI 兼容端點 base URL（接中轉/Azure 時改，留空=官方） | `https://...` |
| `DEEPSEEK_API_KEY` | DeepSeek（OpenAI 兼容端點）金鑰 | `sk-...` |
| `DEEPSEEK_ANTHROPIC_TOKEN` | DeepSeek Anthropic 端點 token | `sk-...` |
| `KIMI_ANTHROPIC_TOKEN` | Kimi（Moonshot）Anthropic 端點 token | `sk-...` |
| `TAVILY_API_KEY` | 網上搜尋（`!搜尋`）用，到 tavily.com 註冊 | `tvly-...` |
| `AUTO_SEARCH` | 自動聯網開關（偵測最新/今天/價格等關鍵字自動搜尋） | `true` / `false` |
| `OPENAI_API_KEY` | OpenAI 金鑰 | `sk-...` |
| `GOOGLE_API_KEY` | Google Gemini 金鑰 | `AIza...` |
| `ANTHROPIC_API_KEY` | Claude 原生金鑰 | `sk-ant-...` |
| `SYSTEM_PROMPT` | 自訂系統提示詞（留空用預設客服） | 留空 |

**支援的 provider**（對應 `LLM_PROVIDER`）：

| provider | 底層 API | 預設模型 |
|---|---|---|
| `deepseek` | DeepSeek OpenAI 兼容 | `deepseek-v4-flash` |
| `deepseek-anthropic` | DeepSeek Anthropic 兼容 | `deepseek-v4-pro[1m]` |
| `kimi` | Moonshot Kimi Anthropic 兼容 | `kimi-k3[1m]` |
| `openai` | OpenAI（可自訂 `OPENAI_BASE_URL`） | `gpt-4o-mini` |
| `google` | Google Gemini | `gemini-2.5-flash` |
| `anthropic` | Anthropic 原生（可自訂 `ANTHROPIC_BASE_URL`） | `claude-haiku-4-5` |

---

## 4. 安裝與啟動

```bash
# 1. 進入專案
cd whatsapp-multi-llm-bot

# 2. 安裝依賴（第一次）
npm install

# 3. 建立設定檔並編輯
cp .env.example .env
#   編輯 .env：至少填 ADMIN_PHONES 和一個對應的 API key

# 4. 啟動
npm start
#   終端機顯示 QR Code，用手機 WhatsApp → 設定 → 已連結的裝置 掃描登入

# 5. 看到這行代表成功
# ✅ Bot 已連線，號碼: 852xxxxxxxx:xx@s.whatsapp.net
```

**Docker 部署**（推薦長開）：

```bash
docker compose up -d --build
docker compose logs -f bot   # 第一次看 QR，掃碼登入
docker compose restart bot   # 重啟
```

---

## 5. 使用指令總表

管理員在**私訊**或**群組內**打（只有管理員有效）：

| 指令 | 作用 |
|---|---|
| `/help` | 顯示指令清單 |
| `/admin <號碼>` | 設為管理員 |
| `/unadmin <號碼>` | 移除管理員（`.env` 種子管理員不可移除） |
| `/allow <號碼>` | 授權可問問題 |
| `/remove <號碼>` | 移除授權 |
| `/ban <號碼>` | 封鎖（加入黑名單） |
| `/unban <號碼>` | 解除封鎖 |
| `/model <名稱>` | 切換模型（或 `/model` 查目前） |
| `/list` | 查看管理員/受權/黑名單/群組 |
| `/clear` | 清除當前對話記憶 |
| `/addgroup` | 授權當前群組（群內使用） |
| `/ungroup` | 移除當前群組授權（群內使用） |
| `/myid` | 查看 bot 看到你的號碼（診斷用） |
| `/leave` | bot 退出當前群組 |

**工具指令**（受權用戶，群組/私訊皆可用）：

| 指令 | 作用 | 需要 key |
|---|---|---|
| `!搜尋 <關鍵字>` | 網上搜尋文章並整理重點 | `TAVILY_API_KEY` |
| `!影片 <關鍵字>` | 搜尋 YouTube 影片（標題/頻道/連結） | `GOOGLE_API_KEY` |
| `!分析 <網址>` | 抓取文章/影片內容並分析 | 免 key（Jina Reader） |

**客人怎麼問**：

- 私訊：受權客人直接問。
- 群組：打前綴符號（預設 `!`）、或 `@提及 bot`、或說暗號（若設了）。

---

## 6. 權限模型

| 身分 | 能做什麼 |
|---|---|
| **種子管理員**（.env 的 `ADMIN_PHONES`） | 全部權限，且不可被 `/unadmin` 移除 |
| **動態管理員**（`/admin` 加入） | 全部權限，但可被 `/unadmin` 移除 |
| **受權客人**（`/allow` 加入） | 問問題（私訊直接問、群組用觸發） |
| **黑名單**（`/ban`） | 一概不理 |
| **未受權** | 一概不理 |

權限判斷流程（`src/handlers.js` → `handleMessage`）：

1. 管理指令（`/` 開頭 + 是管理員）→ 執行指令
2. 黑名單 → 忽略
3. 未受權 → 忽略
4. 群組：需群組已授權 + 觸發（@提及/符號/暗號）
5. 呼叫 LLM 並回覆

---

## 7. 修正紀錄（每個改動的位置）

> 以下按檔案列出本次整合所做的所有修正，方便日後查找與復原。

### 7.1 `src/llm.js` — LLM 呼叫與對話記憶

| 修正 | 位置 | 說明 |
|---|---|---|
| 新增 `deepseek-anthropic` provider | `PROVIDERS` 物件 | 連 DeepSeek Anthropic 端點，模型 `deepseek-v4-pro[1m]` |
| 新增 `kimi` provider | `PROVIDERS` 物件 | 連 Moonshot Kimi Anthropic 端點，模型 `kimi-k3[1m]` |
| 修正 Anthropic 端點 URL | `deepseek-anthropic.url`、`kimi.url` | **必須加 `/v1/messages` 後綴**，否則 404 |
| 修正回應解析 | `anthropicChat()` 內 | DeepSeek/Kimi 會先回 `thinking` 區塊，需抓 `type === 'text'` 的內容，不能取 `[0]` |
| 對話記憶持久化 | 檔案底部 `loadHistory`/`saveHistory` 等 | 從記憶體 Map 改為寫入 `data/history/`，重啟不丟；上限 60 條 |

### 7.2 `config.js` — 設定

| 修正 | 位置 | 說明 |
|---|---|---|
| 新增 key 欄位 | `apiKeys` 物件 | 新增 `deepseekAnthropic`、`kimi` |
| 新增 base URL | `anthropicBaseUrl` | 讓 `anthropic` provider 可自訂端點 |

### 7.3 `.env` / `.env.example`

| 修正 | 說明 |
|---|---|
| 新增 `DEEPSEEK_ANTHROPIC_TOKEN`、`KIMI_ANTHROPIC_TOKEN` | 對應 `start.sh` 的 DeepSeek/Kimi Anthropic token |
| 新增 `TAVILY_API_KEY`、`AUTO_SEARCH` | 工具搜尋 key 與自動聯網開關 |
| 新增 `OPENAI_BASE_URL` | OpenAI 兼容端點（接中轉/Azure 時用） |
| `.env` 設定 `LLM_PROVIDER=openai`、`LLM_MODEL=gpt-4o-mini` | 預設改為 OpenAI GPT（需 VPN 或海外伺服器） |

### 7.4 `src/index.js` — 入口

| 修正 | 位置 | 說明 |
|---|---|---|
| 移除 `printQRInTerminal` | `makeWASocket` 選項 | 該選項已棄用，改自己監聽事件印 QR |
| 自行印 QR | `connection.update` 內 `if (qr)` | 用 `qrcode-terminal` 印 QR 到終端機 |
| 關閉初始查詢 | `fireInitQueries: false` | 修 `init queries` 60s Timed Out 卡上線的問題 |
| 關閉上線 presence | `markOnlineOnConnect: false` | 減少不必要的請求 |
| 診斷 log | `messages.upsert`、`group-participants.update` 內 | 加 `📩 收到訊息`、`👥 群組事件` 方便除錯 |
| 接 logger | 連線/錯誤處 | 記錄連線與錯誤 |

### 7.5 `src/utils.js` — 工具

| 修正 | 說明 |
|---|---|
| 新增 `isLid(jid)` | 判斷 jid 是否為 WhatsApp 新版 `@lid` 格式 |

### 7.6 `src/contacts.js` — 新檔案（lid ↔ 電話對應）

| 修正 | 說明 |
|---|---|
| 建立對應表 | `lidToPhone`、`phoneToLid` 兩個 Map |
| `registerLidPhone` | 註冊一組 lid↔電話 對應 |
| `registerFromGroupMetadata` | 從 `groupMetadata` 的 participants 批量建立對應 |
| `phoneFromLid` / `lidFromPhone` | 查詢對應 |

> **為什麼需要這個？** WhatsApp 新版協議中，群組成員改用 `@lid`（Linked ID）而非電話號碼識別。
> 若不轉換，`85266799087`（管理員）會變成 `1314427789506@lid`，導致權限判斷全部失效、bot 不理人。

### 7.7 `src/handlers.js` — 訊息與指令處理

| 修正 | 位置 | 說明 |
|---|---|---|
| 引入 contacts/logger | 頂部 import | 使用 lid 對應與 log |
| `resolvePhone` / `resolveGroupSender` | 檔案頂部 | 把 `@lid` 對應回電話號碼；群組內會先抓 `groupMetadata` 建立對應 |
| 群組事件判斷 lid | `handleGroupUpdate` | `botAdded` 與 `authorPhone` 都支援 lid |
| @提及判斷 lid | `handleMessage` 群組觸發 | `mentioned` 判斷同時比對 bot 的 `id` 與 `lid` |
| 記錄對話 | `handleMessage` | 收到訊息與回覆都寫 log |
| 新增指令 `/unadmin` | `handleCommand` | 移除管理員，但 `.env` 種子管理員不可移除 |
| 新增指令 `/addgroup` | `handleCommand` | 手動授權當前群組 |
| 新增指令 `/ungroup` | `handleCommand` | 移除當前群組授權 |
| 新增指令 `/myid` | `handleCommand` | 查看 bot 看到你的號碼（診斷） |
| 更新 `/help` 文案 | `helpText()` | 加入新指令說明 |

### 7.8 `src/store.js` — 權限狀態

| 修正 | 說明 |
|---|---|
| 新增 `removeAdmin(phone)` | 移除管理員 |
| 新增 `removeGroup(jid)` | 移除群組授權 |

### 7.9 `src/logger.js` — 新檔案（log 寫檔）

| 修正 | 說明 |
|---|---|
| `logInfo` / `logError` / `logMessage` | 寫入 `data/logs/YYYY-MM-DD.log`（按日期分檔） |

### 7.10 `src/tools.js` — 新檔案（網上搜尋 / YouTube / 分析）

| 修正 | 說明 |
|---|---|
| `searchWeb(query)` | Tavily 網上搜尋（需 `TAVILY_API_KEY`） |
| `searchYouTube(query)` | YouTube Data API v3 搜尋（需 `GOOGLE_API_KEY`） |
| `fetchPage(url)` | Jina Reader 抓取網頁內容（免 key） |

### 7.11 `src/handlers.js` — 工具指令

| 修正 | 位置 | 說明 |
|---|---|---|
| 引入 tools | 頂部 import | 使用 `searchWeb`/`searchYouTube`/`fetchPage` |
| 工具分流 | `handleMessage` 內 | 呼叫 `handleToolCommand`，命中工具就抓資料餵 LLM 整理 |
| `handleToolCommand` | 新函式 | 解析 `!搜尋`/`!影片`/`!分析` 前綴並執行 |
| `/help` 加工具說明 | `helpText()` | 加入工具指令文案 |

### 7.12 `config.js` / `.env` — 工具 key

| 修正 | 說明 |
|---|---|
| `apiKeys.tavily` | 新增 `TAVILY_API_KEY` 欄位 |

### 7.13 `config.js` / `llm.js` — OpenAI 接駁

| 修正 | 位置 | 說明 |
|---|---|---|
| 新增 `openaiBaseUrl` | `config.js` | 讀取 `OPENAI_BASE_URL`，接中轉/Azure 時可改端點 |
| OpenAI provider 用可變 URL | `llm.js` 的 `openai.url` | 由 `config.openaiBaseUrl` 提供，留空用官方 |

> **為何用 OpenAI 需 VPN？** OpenAI 限制部分地區存取（回 `unsupported_country_region_territory`）。
> 方案：① 本機開 VPN（如 Proton VPN 連美/日/新）；② 搬到海外 VPS（見第 10 章）。

### 7.14 `config.js` / `handlers.js` — 自動聯網

| 修正 | 位置 | 說明 |
|---|---|---|
| 新增 `autoSearch` 開關 | `config.js` | 讀取 `AUTO_SEARCH`，預設開 |
| 時間敏感關鍵字偵測 | `handlers.js` 的 `TIME_SENSITIVE_KEYWORDS` / `isTimeSensitive` | 命中最新/今天/價格/新聞等關鍵字自動搜尋 |
| 自動搜尋回答 | `handlers.js` 的 `autoSearchAndAnswer` | 抓取搜尋結果再餵 LLM 整理 |
| 修正預設系統提示詞 | `config.js` 的 `DEFAULT_SYSTEM_PROMPT` | 改為「即時聯網智能助理」 |

---

## 8. 擴展指引

### 8.1 新增一個 LLM provider

在 `src/llm.js` 的 `PROVIDERS` 物件加一筆，例如：

```js
myprovider: {
  type: 'openai',                       // openai / anthropic / google 三種之一
  url: 'https://api.example.com/v1/chat/completions',  // openai 類型才需要 url
  key: () => config.apiKeys.myprovider, // 對應 config.js 的 key
  defaultModel: 'model-name',
},
```

同時：
1. 在 `config.js` 的 `apiKeys` 加 `myprovider: process.env.MYPROVIDER_API_KEY || ''`。
2. 在 `.env.example` 加對應欄位。

`AVAILABLE_PROVIDERS` 會自動更新，`/model` 指令與 `/help` 文案自動納入。

### 8.2 新增一個管理指令

在 `src/handlers.js` 的 `handleCommand` 的 `switch` 加 `case`，並在 `helpText()` 補說明即可。

### 8.3 調整對話記憶上限

修改 `src/llm.js` 頂部的 `HISTORY_LIMIT`（目前 60）。

### 8.4 調整群組觸發行為

- 符號前綴：`.env` 的 `TRIGGER_SYMBOL`。
- 暗號：`.env` 的 `TRIGGER_PASSPHRASE`。
- 邏輯在 `src/handlers.js` → `handleMessage` 的群組觸發判斷區。

### 8.5 記錄「被擋的訊息」

目前只記成功收發與錯誤。若要追蹤被權限擋下的訊息，可在 `handleMessage` 的每個 `return` 前加 `logInfo(...)`。

### 8.6 新增一個工具指令

1. 在 `src/tools.js` 新增抓取函式（例如 `searchNews`）。
2. 在 `src/handlers.js` 的 `handleToolCommand` 的 `prefixes` 陣列加一個前綴，並加對應的處理分支。

---

## 9. 資料位置與備份

| 路徑 | 內容 | 備份建議 |
|---|---|---|
| `data/auth/` | WhatsApp 登入憑證 | **務必加密備份**，洩漏=帳號被劫持 |
| `data/state.json` | 管理員/受權/黑名單/群組 | 定期備份 |
| `data/history/` | 對話上下文記憶 | 可選 |
| `data/logs/` | 對話與事件 log | 可選 |

**換 bot 號碼**：停程式 → 刪 `data/auth/` → 重跑 → 新號碼掃 QR。

---

## 10. 海外 VPS 部署（規劃中）

> 目的：把整個 bot 搬到美國 / 日本 / 新加坡的伺服器上，**出口 IP 位於 OpenAI 支援地區**，
> 這樣無需 VPN、無需中轉服務，同時兼得「24/7 長開」與「OpenAI 地區限制解除」。

### 10.1 為什麼這麼做

| 方式 | OpenAI 限制 | 長開 | 備註 |
|---|---|---|---|
| 本機 + Proton VPN | ✅ 解決 | ❌ 需自機常開 | VPN 斷線即失效 |
| 本機 + 中轉服務 | ✅ 解決 | ❌ | 第三方可信度需自行評估 |
| **海外 VPS（本方案）** | ✅ 解決 | ✅ 伺服器本就長開 | 推薦 |

### 10.2 選擇伺服器

| 地點 | 每月成本（小 VPS） | 備註 |
|---|---|---|
| 美國 | USD 3–8 | 最便宜，OpenAI 支援 |
| 新加坡 | USD 5–15 | 離香港近、延遲低 |
| 日本 | USD 5–12 | 離香港近 |

常見供應商：Vultr / DigitalOcean / Linode / AWS Lightsail / GCP（自行評估選用）。

### 10.3 部署步驟（草案）

```bash
# 1. 買 VPS、取得 IP，SSH 登入
ssh root@你的伺服器IP

# 2. 安裝 Node.js ≥ 18 與 Docker（選一即可）
#    Node 方式：
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
#    Docker 方式：
curl -fsSL https://get.docker.com | sh

# 3. 上傳專案（本機執行）
scp -r whatsapp-multi-llm-bot root@你的伺服器IP:/root/

# 4. 進專案、設定 .env
cd /root/whatsapp-multi-llm-bot
cp .env.example .env
#    編輯 .env：LLM_PROVIDER=openai、OPENAI_API_KEY=你的key、ADMIN_PHONES=你的號碼
#    ⚠️ 不需 VPN、不需 OPENAI_BASE_URL（用官方即可）

# 5. 啟動
npm install && npm start        # Node 方式
# 或
docker compose up -d --build    # Docker 方式（推薦長開）

# 6. 第一次掃 QR（在伺服器終端機）
docker compose logs -f bot
```

### 10.4 注意事項

1. **WhatsApp 風控**：香港號碼突然從海外 IP 登入，可能觸發 WhatsApp 驗證。建議新伺服器用**獨立 bot 號碼**，或搬遷後保持 IP 穩定別頻繁更換。
2. **`data/` 要一起搬**：`data/auth`（登入憑證）、`data/state.json`（名單）都需搬上伺服器，或重新掃碼登入。
3. **`.env` 的 key 是敏感資料**：透過 scp 傳輸時注意安全，勿放到公開 repo。
4. **Docker 長開**：`docker-compose.yml` 已含 `restart: unless-stopped`，重啟自動恢復。

### 10.5 狀態

- [ ] 選定 VPS 供應商與地點
- [ ] 部署並掃 QR 登入
- [ ] 驗證 OpenAI 呼叫（`/model` 確認 `openai`）
- [ ] 驗證群組問答

---

## 附錄：常見問題

| 症狀 | 原因 / 解法 |
|---|---|
| QR 碼不顯示 | Node 版本 <18；或 Baileys 已棄用 `printQRInTerminal`（已改自印） |
| 連線後 60s `init queries` Timed Out | 已用 `fireInitQueries: false` 關閉；若再出現查網路/VPN |
| bot 收到訊息但不理人 | 檢查 sender 是否 `@lid` 格式（lid 對應是否失效）；或未授權 |
| 群組拉進後沒「🤖 已加入」 | 用 `/addgroup` 手動補授權，或確認拉群者是否管理員 |
| AI 回「暫時無法回答」 | API key 沒填/填錯，或模型名過時（看 `data/logs/` 的錯誤） |
| 報 `model not found` | 模型名改了，填正確名到 `LLM_MODEL` |
| OpenAI 回 403 `unsupported_country_region_territory` | 地區限制；本機開 VPN，或搬到海外 VPS（見第 10 章） |
