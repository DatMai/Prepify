# ADR-002: Phân quyền Library và đồng bộ Obsidian theo mô hình projection

**Status:** Accepted
**Date:** 2026-09-11
**Decider:** Đạt

## Context

Prepify có hai loại dữ liệu với vòng đời khác nhau:

- PostgreSQL đang quản lý tài khoản, quyền, progress và dữ liệu vận hành của web app.
- Obsidian đang quản lý kiến thức cá nhân và Daily dưới dạng Markdown, có thể được sửa bởi Đạt, Claude hoặc Codex.

Nếu cả PostgreSQL và Obsidian cùng được phép sửa một bản nội dung như hai nguồn ngang hàng, hệ thống sẽ sớm gặp split-brain, ghi đè và xung đột khó truy vết. Library cũng không được đưa vào frontend bundle vì nội dung cá nhân phải riêng tư khi deploy.

## Decision

Chọn mô hình **mỗi loại dữ liệu có một nguồn sự thật, PostgreSQL chỉ giữ projection khi thật sự cần truy cập từ xa**.

| Dữ liệu                           | Source of truth   | Vai trò hệ thống còn lại              |
| --------------------------------- | ----------------- | ------------------------------------- |
| Identity, role, session, progress | PostgreSQL        | Không ghi vào Obsidian                |
| Knowledge, theory, Daily          | Obsidian/Markdown | App đọc qua API admin-only            |
| Trạng thái đồng bộ                | PostgreSQL        | Hash, revision, thời điểm và lỗi sync |

Áp dụng ngay:

- `users.role` là `user` hoặc `admin`; route Library và Journey kiểm tra role từ database ở mỗi request.
- Nội dung `content/*.json` được đọc ở server, không còn import vào frontend bundle.
- Journey vẫn theo ADR-001: local-only, revision SHA-256, atomic write và không last-write-wins.
- Tài khoản trong `ADMIN_EMAILS` được đồng bộ thành admin khi server khởi động.

Khi cần deploy để đọc vault từ điện thoại, thêm lớp projection thay vì mirror hai chiều trực tiếp:

```text
Obsidian (canonical Markdown)
        ↕ local sync bridge
PostgreSQL projection + command outbox
        ↕ authenticated API
Prepify web/mobile
```

- `vault_documents`: `owner_id`, `vault_path`, `content_hash`, `source_mtime`, nội dung đã sanitize/render, `synced_at`, `sync_status`.
- `vault_commands`: lệnh sửa có `idempotency_key`, `expected_hash`, payload có kiểu, trạng thái và lỗi.
- Local bridge chỉ áp dụng command khi `expected_hash` còn khớp; nếu lệch thì báo conflict để người dùng quyết định.
- Không lưu secret, file tài chính hay toàn bộ vault trong projection; chỉ allowlist đúng collection cần hiển thị.

Các bảng projection/outbox **đã được tạo** khi triển khai remote phase (migration
`013_add_journey_sync.sql`), với tên thực tế là `journey_projections`,
`journey_sync_jobs` và `journey_audit_events`. Giai đoạn local trước đó cố tình
chưa dựng chúng.

## Options considered

### A. Obsidian canonical + PostgreSQL projection/outbox — chọn

**Ưu:** giữ trải nghiệm Markdown/offline, app đọc nhanh từ xa, có audit và xử lý conflict rõ ràng.
**Nhược:** cần một local sync agent khi triển khai remote.

### B. Đồng bộ hai chiều trực tiếp, hai nguồn ngang quyền — loại

**Ưu:** cả app và Obsidian đều sửa tự do.
**Nhược:** split-brain, khó đảm bảo thứ tự ghi và dễ mất nội dung.

### C. PostgreSQL canonical rồi export sang Obsidian — chưa chọn

**Ưu:** web app đơn giản hơn.
**Nhược:** Obsidian không còn là second brain gốc và agent/file edit có thể bị ghi đè.

## Consequences

- Public account không thể gọi Library/Journey dù biết URL API.
- Frontend production không chứa corpus Library; server phải bảo vệ và phục vụ nó.
- Role luôn được kiểm tra từ DB, nên đổi quyền có hiệu lực mà không cần chờ JWT hết hạn.
- Remote sync sau này là một phase riêng với allowlist, encryption in transit, audit log và conflict UI.

## Cập nhật 2026-09-13: projection và outbox đã được triển khai

Remote phase trong phần "Consequences" ở trên **đã hoàn thành**, nên các mục dưới
đây là hiện trạng chứ không còn là dự định.

- `journey_projections` giữ projection mỗi vault, `journey_sync_jobs` là outbox
  job có idempotency key và lease, `journey_audit_events` chỉ ghi
  định danh/trạng thái/revision đã sanitize.
- Route hosted chỉ nhận dữ liệu có cấu trúc. Chúng từ chối `path`, `markdown`,
  mọi khoá không nằm trong allowlist, và yêu cầu cả `Idempotency-Key` lẫn
  `If-Match` cho mutation.
- Bridge local là **thành phần duy nhất** được biết đường dẫn vault. Nó áp dụng
  mutation khi `expected_hash` còn khớp, và báo conflict khi lệch.
- Revision là SHA-256: `sha256:<64 hex>` **trên đường truyền**, còn database lưu
  dạng bare hex và chỉ chuẩn hoá ở biên.
- Bảo vệ ghi đè nằm ở hai lớp: compare-and-swap revision trong transaction phía
  server, và kiểm tra revision khi bridge đọc note trước lúc ghi.
- Một hệ quả vận hành mới: server thông báo cho **mọi** connection của owner,
  nên đúng một owner – một vault – một bridge. Bridge thứ hai trên vault khác sẽ
  giành job và ghi revision sai của nó vào projection.

**Bằng chứng:** smoke matrix 2026-09-13 trên nhánh `feat/overhaul-completion`
đạt **36/36** (21 check HTTP API, 15 check bridge), bao gồm cả đường conflict
`409` với đầy đủ hai revision và không rò nội dung note.
