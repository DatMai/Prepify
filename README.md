# Tech Interview Study

Interactive study app cho câu hỏi phỏng vấn tech (JS, TS, Node, DSA, OOP, OS, Networking, DBMS, System Design).

## Stack

- **Vite** + **TypeScript** (vanilla, không framework)
- **CSS** modular trong `src/styles/`
- **Content** dạng JSON, mỗi topic 1 file trong `content/`
- Progress lưu vào `localStorage` (fallback từ `window.storage` nếu host inject)

## Scripts

```bash
npm install
npm run dev        # khởi động dev server (http://localhost:5173)
npm run build      # type-check + build production vào dist/
npm run preview    # preview bản build
npm run typecheck  # chỉ chạy tsc --noEmit
```

## Cấu trúc

```
quiz/
├── index.html              # entry HTML (markup + module script)
├── content/                # quiz data
│   ├── index.json          # danh sách topic + metadata
│   ├── javascript.json
│   ├── typescript.json
│   └── ... (mỗi topic 1 file)
├── src/
│   ├── main.ts             # entry point
│   ├── events.ts           # global event handlers
│   ├── types/quiz.ts       # TS interfaces (Topic, Section, Question, Block...)
│   ├── data/loader.ts      # load tất cả JSON qua import.meta.glob
│   ├── state/progress.ts   # state + persistence (localStorage)
│   └── render/
│       ├── escape.ts       # esc(), hl() — XSS-safe escape + highlight
│       ├── block.ts        # render từng block (text/code/note/table)
│       ├── runCode.ts      # eval JS snippet với fake console
│       ├── sidebar.ts      # render topic list + global progress
│       └── content.ts      # render content chính
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Thêm topic mới

1. Tạo file `content/<topic>.json` theo schema trong [src/types/quiz.ts](src/types/quiz.ts) (`Topic`).
2. Thêm 1 entry vào `content/index.json` (`key`, `label`, `title`, `color`, `questionCount`).
3. (Tùy chọn) Thêm icon vào `ICON` map trong [src/data/loader.ts](src/data/loader.ts).

File mới sẽ được Vite tự nhặt qua `import.meta.glob('../../content/*.json')`.
