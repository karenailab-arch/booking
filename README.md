# 結構調理師預約網站

這是一個可直接使用的預約網站，功能包含：

- 前台：客戶填寫預約資料
- 後台：查看預約、更新狀態、刪除資料
- 免費資料庫管理：使用 Supabase Free Plan（含網頁化管理後台 Supabase Studio）

## 1) 建立 Supabase 專案（免費）

1. 到 [Supabase](https://supabase.com/) 註冊並建立新專案（選 Free）。
2. 開啟 SQL Editor，貼上 `supabase-schema.sql` 全部內容並執行。
3. 在 `Project Settings -> API` 取得：
   - Project URL
   - anon public key

## 2) 設定環境變數

1. 複製 `.env.example` 為 `.env`
2. 填入你自己的 Supabase 參數：

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 3) 啟動專案

```bash
npm install
npm run dev
```

瀏覽器打開本機網址後可在頁面上切換：

- `預約頁面`：客戶建立預約
- `管理後台`：店家管理預約狀態

## 4) 免費後台資料庫管理位置

Supabase 提供免費的後台管理介面（Supabase Studio）：

- `Table Editor`：查看/編輯資料
- `SQL Editor`：執行查詢
- `Authentication`：若你日後要加後台登入可在此設定

## 正式可公開營運版本（已內建）

目前程式已升級為正式營運安全模型：

- 前台（匿名）只能新增預約
- 後台（登入後）才可讀取/更新/刪除預約
- 同調理師同日期同時段不可重覆預約（防撞單）

### 必做設定：建立管理員帳號

1. 到 Supabase `Authentication -> Users` 新增一位管理員（Email + Password）
2. 到 SQL Editor 執行以下 SQL，把該帳號設為管理員：

```sql
insert into public.admin_users (user_id)
values ('這裡填 auth.users 裡該管理員的 id');
```

> `auth.users.id` 可在 Supabase 的 Authentication Users 列表看到。

### 管理員忘記密碼 / 重設密碼流程

- 後台登入框已內建 `忘記密碼` 按鈕，輸入 Email 後可寄重設信
- 點擊信件連結後會導回網站並進入「重設管理員密碼」畫面
- 新密碼更新完成後即可重新登入

> 請在 Supabase `Authentication -> URL Configuration` 將 Site URL 設成你的正式網域（Vercel 網址）。

### 升級既有專案

如果你之前已跑過舊版 SQL，請再到 SQL Editor 重新執行一次 `supabase-schema.sql`，它會更新政策與索引。

## Vercel 一鍵部署（可上線版本）

### 方法 A：Deploy Button（最快）

把這個連結貼到瀏覽器（會自動匯入到你的 Vercel）：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-name=booking-site&project-name=booking-site&repository-url=https://github.com/your-username/your-repo)

> 先把本專案推到你自己的 GitHub 倉庫，再把上面網址中的 `your-username/your-repo` 改成你的倉庫網址。

### 方法 B：Vercel 後台匯入

1. 將本專案推到 GitHub
2. 到 [Vercel](https://vercel.com/) -> `Add New...` -> `Project`
3. 匯入 GitHub 倉庫（Framework 會自動辨識 Vite）
4. 在 Environment Variables 加入：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. 按下 Deploy

部署後，Vercel 會提供公開網址（例如 `https://xxx.vercel.app`）。

### 重新部署

- 每次 push 到主要分支，Vercel 會自動重新部署
- 如果只改環境變數，請在 Vercel 專案頁面手動觸發 Redeploy

## 營運前檢查清單

- [ ] 前台可送出預約
- [ ] 重複時段會被阻擋
- [ ] 未登入無法看到後台預約清單
- [ ] 管理員可登入、修改狀態、刪除預約
- [ ] Vercel 上線網址可正常讀寫 Supabase
- [ ] 忘記密碼重設流程可用（信件可收）
- [ ] 後台可看到操作紀錄

## 預約通知（Email / LINE）

本專案使用 `notification_settings` + SQL trigger 在「新預約」或「狀態變更」時呼叫 webhook。

### 設定方式

1. 準備 webhook 服務（擇一）：
   - Email：可用 Make / Zapier / n8n webhook 後轉寄 Email
   - LINE：可用 LINE Messaging API webhook 中繼服務
2. 在 Supabase SQL Editor 新增設定：

```sql
insert into public.notification_settings (channel, webhook_url, is_active)
values ('email_webhook', 'https://your-webhook.example.com/notify', true);
```

LINE 再加一筆即可：

```sql
insert into public.notification_settings (channel, webhook_url, is_active)
values ('line_webhook', 'https://your-line-webhook.example.com/notify', true);
```

Webhook 會收到 JSON payload，包含客戶、時段、狀態等欄位。

## 後台操作紀錄

- 已新增 `appointment_audit_logs` 表
- 每次新增 / 更新 / 刪除預約都會自動記錄：
  - 動作類型
  - 操作者 `actor_user_id`
  - 變更前/後資料（JSON）
- 後台頁面已可直接查看最近 100 筆操作紀錄
