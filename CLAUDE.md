# Tech Interview Study — Project Context

> Đọc file này trước khi làm bất cứ thứ gì. Nó mô tả **trạng thái thực tế** của project.

## Tổng quan

Quiz app học phỏng vấn tech (JS, TS, Node, DSA, OOP, OS, Networking, DBMS, System Design).
Bắt đầu là 1 file HTML duy nhất (~560KB), đã refactor thành full-stack Node.js project.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + TypeScript (vanilla, không framework) |
| Backend | Express + TypeScript |
| Database | PostgreSQL 18 (Homebrew, chạy port 5432) |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| API Docs | Swagger UI tại `http://localhost:3001/docs` |

---

## Cấu trúc thư mục

```
quiz/
├── CLAUDE.md                   ← file này
├── index.html                  # Vite entry
├── tech-interview-study.html   # file gốc, giữ lại để tham khảo, CHƯA XÓA
├── content/                    # quiz data (JSON, không đụng vào)
│   ├── index.json              # danh sách 9 topics + metadata
│   └── javascript.json … system.json
├── src/                        # Frontend TypeScript
│   ├── main.ts                 # entry: init auth → loadProgress → bindEvents → render
│   ├── events.ts               # search, quizToggle, menuBtn
│   ├── api/client.ts           # typed fetch wrapper → localhost:3001
│   ├── types/quiz.ts           # Topic, Section, Question, Block interfaces
│   ├── state/
│   │   ├── auth.ts             # AuthState, setSession/clearSession/restoreSession
│   │   └── progress.ts         # state, keyOf, loadProgress, saveProgress, toggleProgress
│   ├── render/
│   │   ├── block.ts            # render từng block (text/code/note/table)
│   │   ├── content.ts          # main render loop
│   │   ├── escape.ts           # esc(), hl() — XSS safe
│   │   ├── runCode.ts          # eval JS/TS snippet với fake console
│   │   └── sidebar.ts          # renderTopics, updateGlobalProgress
│   ├── ui/
│   │   └── authModal.ts        # login/register modal + session merge logic
│   ├── data/loader.ts          # import.meta.glob load tất cả content/*.json
│   └── styles/
│       ├── main.css            # @import tất cả partial
│       ├── variables.css       # CSS custom properties
│       ├── sidebar.css
│       ├── topbar.css
│       ├── card.css
│       ├── blocks.css
│       ├── auth.css            # modal + auth button styles
│       └── responsive.css
├── server/                     # Backend Express
│   ├── .env                    # PORT=3001, DATABASE_URL, JWT_SECRET (gitignored)
│   ├── .env.example
│   ├── migrations/001_init.sql # users + progress tables
│   └── src/
│       ├── index.ts            # app entry, mounts routes + swagger
│       ├── swagger.ts          # OpenAPI spec config
│       ├── db/
│       │   ├── client.ts       # pg Pool
│       │   └── migrate.ts      # chạy migrations/*.sql
│       ├── middleware/auth.ts  # requireAuth (JWT verify)
│       └── routes/
│           ├── auth.ts         # POST /auth/register, /auth/login, GET /auth/me
│           └── progress.ts     # GET/PUT/PATCH /progress (authenticated)
├── package.json                # frontend (vite, typescript)
├── tsconfig.json
└── vite.config.ts
```

---

## Cách chạy

```bash
# 1. Start PostgreSQL (nếu chưa chạy)
brew services start postgresql@18

# 2. Backend (terminal 1)
cd server && npm run dev        # http://localhost:3001
                                # Swagger: http://localhost:3001/docs

# 3. Frontend (terminal 2)
npm run dev                     # http://localhost:5173

# Chạy migration lần đầu (nếu DB mới)
cd server && npm run migrate
```

### Kill port nếu cần
```bash
lsof -ti :3001 | xargs kill -9   # backend
lsof -ti :5173 | xargs kill -9   # frontend
```

---

## Database

- **Host**: localhost:5432
- **Database**: `quiz_app`
- **User**: `daemonthetarnished` (macOS username, không cần password)
- **Tables**: `users` (id, email, password_hash, display_name, created_at), `progress` (user_id FK, data JSONB, updated_at)
- pgAdmin: connect với host=localhost, port=5432, user=daemonthetarnished, password trống

---

## Logic quan trọng

### Progress sync
- **Guest** (chưa login): lưu vào `localStorage` key `quiz:progress`
- **Logged in**: dùng API (`PATCH /progress` per-key, `PUT /progress` bulk)
- Khi login: nếu localStorage có data → merge lên server (server wins nếu đã có data)
- `toggleProgress()` trong `state/progress.ts` là entry point cho mọi thay đổi progress

### Auth flow
`restoreSession()` → check token trong localStorage → `GET /auth/me` → populate `auth.user`
Nếu token expired/invalid → `clearSession()` → fallback về guest mode

### Data loading
`src/data/loader.ts` dùng `import.meta.glob('../../content/*.json', { eager: true })` — Vite tự bundle tất cả JSON lúc build. Thêm topic mới: tạo file JSON + thêm entry vào `content/index.json`.

---

## Trạng thái hiện tại (2026-05-28)

**Đã xong:**
- [x] Frontend refactor hoàn chỉnh (Vite + TS, CSS modular)
- [x] 9 topics, 524 câu hỏi trong JSON
- [x] Backend Express + TS với auth JWT
- [x] PostgreSQL schema + migrations
- [x] Progress sync (guest localStorage / logged-in API)
- [x] Swagger UI docs
- [x] Auth modal UI (login/register/logout)

**Chưa làm / có thể làm tiếp:**
- [ ] Deploy (frontend static + backend server)
- [ ] Leaderboard / stats
- [ ] Admin UI để quản lý câu hỏi
- [ ] Thêm topic mới
- [ ] Dark/light mode toggle
- [ ] Rate limiting, helmet cho backend security

---

## Quyết định kỹ thuật đã chốt

| Quyết định | Lý do |
|---|---|
| Vite + vanilla TS, không React | App đã là pure DOM API, không cần reactivity framework |
| Mỗi topic 1 file JSON | Dễ edit/thêm topic, không lẫn với code |
| PATCH per-key thay vì PUT cả blob mỗi lần toggle | Tối ưu network, tránh race condition |
| localStorage fallback khi guest | UX tốt hơn — không bắt đăng nhập mới dùng được |
| CommonJS cho server, ESM cho frontend | Vite cần ESM; Node/tsx với CommonJS ổn định hơn |
