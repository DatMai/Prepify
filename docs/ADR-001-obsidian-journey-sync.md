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
