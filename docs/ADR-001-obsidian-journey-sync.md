# ADR-001: Dùng Obsidian làm nguồn sự thật cho Hành trình

**Status:** Accepted
**Date:** 2026-09-10
**Decider:** Đạt

## Context

Prepify đã có quiz, tài khoản và tiến độ trong PostgreSQL. Hành trình học AZ-104, LeetCode và English lại đang được vận hành trong Obsidian, nơi Claude và Codex cũng có thể sửa file. Sao chép kế hoạch sang database sẽ tạo hai nguồn sự thật và dễ lệch tiến độ.

## Decision

Thêm một local-only Obsidian bridge vào Express và một màn hình **Hành trình** riêng trong Prepify.

- Obsidian là nguồn sự thật.
- Phiên bản đầu chỉ được ghi `Daily/<hôm nay tại Asia/Ho_Chi_Minh>.md`.
- App chỉ thực hiện thao tác có kiểu: xem Study, lưu bằng chứng, tick/mở lại task và cập nhật `Done / Blocked / Next`.
- Mọi ghi yêu cầu revision SHA-256, chỉ splice đúng vùng cần sửa và dùng atomic rename.
- Project, resource, lý thuyết, email, tài chính và file hệ thống không được trả về hoặc sửa qua API.

```text
Prepify UI → authenticated localhost API → ObsidianVaultAdapter → Daily/YYYY-MM-DD.md
```

## Options considered

### A. Local Express bridge — chọn

**Ưu:** dùng lại stack hiện tại, ít thành phần, giữ Markdown làm dữ liệu thật.
**Nhược:** chỉ hoạt động trên máy có vault; phải khóa route chặt.

### B. Obsidian plugin

**Ưu:** tích hợp native và có thể phản ứng tốt hơn với thay đổi trong Obsidian.
**Nhược:** thêm một project, secret và vòng đời phát hành riêng; quá nặng cho MVP.

### C. PostgreSQL làm nguồn chính rồi export Markdown

**Ưu:** app web dễ triển khai đa thiết bị.
**Nhược:** tạo split-brain với vault và có nguy cơ ghi đè quyết định từ Claude/Codex; bị loại.

## Consequences

- App triển khai trên cloud không thể truy cập vault local; bridge mặc định tắt nếu chưa cấu hình.
- Xung đột trả về HTTP `412`; UI phải reload thay vì last-write-wins.
- Không tự commit git sau từng click.
- Recall theo Unit AZ-104 là phase sau, chỉ làm khi format lý thuyết đã được người dùng duyệt.

## Cập nhật 2026-09-13: bridge chạy theo yêu cầu, transport WebSocket

ADR này vẫn giữ nguyên quyết định gốc — Obsidian là nguồn sự thật cho Hành trình.
Phần được cập nhật là **cách** app nói chuyện với vault khi API đã deploy lên cloud.

- **Biên sở hữu lai.** PostgreSQL giữ identity, quyền, progress và một
  `journey_projections` chỉ để đọc từ xa. Markdown trong vault vẫn là bản gốc của
  Daily và Hành trình.
- **Bridge chạy theo yêu cầu, không chạy nền.** Người dùng bấm **Sync Obsidian**,
  yêu cầu được ghi thành job trong PostgreSQL, và bridge local nhận thông báo rồi
  mới làm việc. Không polling định kỳ, không quét filesystem khi rảnh.
- **Transport là một WebSocket outbound có xác thực** tại
  `/api/v1/journey/bridge`. Server chỉ gửi **định danh job**, không bao giờ gửi
  đường dẫn vault hay Markdown. Thứ tự là pull-then-push: bridge đọc vault và
  upload projection trước, rồi mới áp các mutation từ database xuống vault.
- **Chỉ bridge được chạm vào đường dẫn vault.** Route hosted không nhận path và
  không nhận Markdown tuỳ ý.
- **Khi bridge offline:** UI nói rõ trạng thái và các thao tác ghi vào vault
  (task, journal, evidence) bị khoá. Quiz Daily thuộc database vẫn dùng được và
  xếp một summary cho lần sync sau.
- **Non-goal:** không có cloud mirror hai chiều của vault. Projection chỉ để đọc
  từ xa, không phải một bản sao có thể sửa ngang hàng.
- **Vận hành:** đúng **một owner – một vault – một bridge**. Server thông báo cho
  mọi connection của owner, nên bridge thứ hai trỏ vào vault khác sẽ giành job và
  ghi revision của vault nó vào projection.

**Bằng chứng (2026-09-13, nhánh `feat/overhaul-completion`):** smoke matrix
**36/36** — 21 check HTTP API surface và 15 check bridge end-to-end, gồm
sync theo yêu cầu, upload projection, mutation database→vault ghi được vào note và
giữ nguyên các section ngoài quyền ghi, reconnect đúng một frame mỗi lần, và
conflict trả `409` kèm cả hai revision `sha256:` đã sanitize.
