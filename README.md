# WhatsApp 多模型問答 Bot（拆骨公司）

支援 DeepSeek / ChatGPT(OpenAI) / Gemini(Google) / Claude(Anthropic)，
並已「連接」Claude Code 的模型後端（DeepSeek / Kimi 的 Anthropic 兼容端點），含權限控管與持久化上文下理。

## 功能
- 多個 LLM 一鍵切換（`/model`）
- 只有管理員能拉 bot 入群（非管理員拉入 → bot 自動退出）
- 群組內要「@提及 / 符號前綴 / 暗號」才回應
- 一般對答（帶上下文記憶，**持久化到磁碟，重啟後仍記得**）
- 封閉式權限：只有「受權名單」內的人能問，未受權一概不理
- 管理員指令：授權、封鎖、切換模型、查名單等
- Docker 部署 + 斷線自動重連

## 支援的模型 provider
| provider 名稱 | 底層 API | 預設模型 | 需要哪個 key |
|---|---|---|---|
| `deepseek` | DeepSeek OpenAI 兼容 | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` |
| `deepseek-anthropic` | DeepSeek Anthropic 兼容（連 Claude Code） | `deepseek-v4-pro[1m]` | `DEEPSEEK_ANTHROPIC_TOKEN` 或 `DEEPSEEK_API_KEY` |
| `kimi` | Moonshot Kimi Anthropic 兼容（連 Claude Code） | `kimi-k3[1m]` | `KIMI_ANTHROPIC_TOKEN` |
| `openai` | OpenAI | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `google` | Google Gemini | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| `anthropic` | Anthropic 原生（或自訂 `ANTHROPIC_BASE_URL`） | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |

> `deepseek-anthropic` 與 `kimi` 這兩個 provider 的端點與模型名，取自你的 `~/claude/start.sh`，
> 讓 WhatsApp bot 跟 Claude Code 用同一套 DeepSeek / Kimi 模型後端。

## 快速開始

### 1. 安裝依賴
```
npm install
```

### 2. 設定 .env
```
cp .env.example .env
```
然後編輯 `.env`：
- `ADMIN_PHONES`：管理員電話（國碼+號碼，逗號分隔），例如 `85291234567`
- `LLM_PROVIDER`：預設模型 provider（例如 `deepseek-anthropic` 或 `kimi`）
- 至少填一個對應的 API Key

### 3. 啟動並掃 QR
```
npm start
```
終端機顯示 QR code，用「bot 的 WhatsApp 帳號」掃描登入。
（bot 需一個獨立手機號碼，用 WhatsApp 多裝置登入。）

### 4. 拉入群
- 由「管理員」把 bot 拉進群 → bot 自動認可並加入。
- 非管理員拉 → bot 自動退出。

## 群組內怎麼問
- @提及 bot
- 或用前綴符號，例如：`!今日營業時間？`
- 或說暗號（若設了 `TRIGGER_PASSPHRASE`）

## 管理員指令（DM 或群組內，管理員限定）
```
/admin 852...   設為管理員
/allow 852...   授權可問問題
/remove 852...  移除授權
/ban 852...     封鎖
/unban 852...   解除封鎖
/model kimi     切換模型（deepseek/deepseek-anthropic/kimi/openai/google/anthropic）
/list           查看名單
/clear          清除對話記憶
/leave          bot 退出群組
/help           說明
```

## Docker 部署
```
docker compose up -d --build
docker compose logs -f bot   # 第一次看 QR
```

## 資料
- `data/auth/`：登入 session（= 憑證，務必保密、備份）
- `data/state.json`：受權名單 / 黑名單 / 管理員 / 群組
- `data/history/`：每個對話的上下文記憶（持久化，重啟不丟）

## 資安提醒
- API Key 是計費的，務必設 `ADMIN_PHONES` + 群組觸發，避免被刷爆帳單。
- 不要讓 bot 直接暴露公網（Baileys 走 outbound，無需開 port）。
- `data/auth` 洩漏 = 帳號被劫持，請妥善保管。
- 換號碼登出時，刪掉 `data/auth` 後重跑重新掃 QR。


## 重設
cd /Users/user/Desktop/whatsapp-multi-llm-bot

# 1. 刪除舊登入憑證
rm -rf data/auth

# 2. 重新啟動（會重新印 QR Code）
npm start
