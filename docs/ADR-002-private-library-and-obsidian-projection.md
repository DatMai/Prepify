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

Các bảng projection/outbox **chưa tạo ở giai đoạn local**. Chỉ thêm khi Đạt chọn triển khai remote, tránh dựng hạ tầng chưa dùng.

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
