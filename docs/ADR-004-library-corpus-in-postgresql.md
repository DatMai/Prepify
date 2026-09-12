# ADR-004: Library corpus và Daily pool thuộc về PostgreSQL

**Status:** Accepted
**Date:** 2026-09-12
**Decider:** Đạt

## Context

Trước ADR này, corpus của Library là các file JSON chỉ đọc trong repo
(`content/*.json`, bản `en` trong `content/en/` bị gitignore). Server đọc bằng
`fs.readFile` trong `routes/library.ts` và `routes/daily.ts`.

Hai áp lực làm cách đó hết phù hợp:

1. Admin panel cần **soạn và sửa** bài học: tạo môn, thêm câu, gắn level, sửa
   câu cũ. Ghi vào file trong working tree là lựa chọn khả thi nhưng chỉ chạy
   được khi tiến trình server có quyền ghi filesystem, và không có ràng buộc
   toàn vẹn nào.
2. Pool Daily tham chiếu câu hỏi **theo vị trí**
   (`ref: { topicKey, sectionIdx, questionIdx }`). Chỉ cần đổi thứ tự hoặc xoá
   một câu là mọi ref phía sau trỏ sai một cách âm thầm.

Spec overhaul đã dự liệu hướng này: "thay corpus thật trong repo bằng một
projection do PostgreSQL quản lý". ADR-002 đặt ra mô hình mỗi loại dữ liệu có
một nguồn sự thật và chỉ giữ projection khi cần truy cập từ xa.

## Decision

**PostgreSQL là nguồn sự thật cho topic, section, question và Daily pool.**

Áp dụng ngay:

- Bốn bảng `library_topics`, `library_sections`, `library_questions`,
  `library_daily_entries` (migration `011_add_library_tables.sql`).
- API đọc giữ **nguyên đường dẫn và shape JSON** như trước: nó project DB ngược
  lại đúng cấu trúc cũ, nên frontend Library, Quiz, Daily và progress không phải
  viết lại. `GET /api/v1/library/index`, `GET /api/v1/library/topics/:key`,
  `GET /api/v1/daily` không đổi hợp đồng.
- `content/*.json` **vẫn nằm trong repo** nhưng đổi vai trò: từ corpus thành
  **snapshot để seed và nguồn import**. Không file nào bị sửa hay xoá.
  `content/en/` vẫn gitignore; thiếu bản `en` chỉ log cảnh báo.
- Seed một lần bằng `npm --prefix server run seed:library`, idempotent
  (`ON CONFLICT DO NOTHING`, chạy lại không nhân bản).
- Seed **giải mã ref vị trí thành FK thật** `library_daily_entries.question_id →
library_questions(id)` với `ON DELETE RESTRICT`. Nhờ vậy việc xoá một câu đang
  được Daily dùng sẽ bị DB chặn thay vì làm pool trỏ sai.
- `library_questions.level` để `NULL` cho toàn bộ câu seed từ corpus: corpus
  không có level, và hệ thống không được đoán.
- `key` của môn là bất biến sau khi tạo, vì nó xuất hiện trong URL, trong khoá
  progress `topic:section:question` và trong tham chiếu Daily.

**Chưa làm ở ADR này:** khoá progress/favorites vẫn theo vị trí. Đổi thứ tự
hoặc xoá câu sẽ làm tiến độ đã học trỏ lệch, nên thao tác đó phải cảnh báo và
yêu cầu xác nhận; chuyển sang UUID câu hỏi là một spec riêng.

## Options considered

### A. Chuẩn hoá quan hệ trong PostgreSQL, project lại shape cũ khi đọc — chọn

**Ưu:** FK thật nên ref Daily an toàn; sửa một câu là một `UPDATE` nhỏ; ràng
buộc `UNIQUE (key, locale)` và `position` do DB đảm bảo; test được từng tầng;
frontend không đổi.
**Nhược:** nhiều bảng và phải viết code projection; seed phải map ba tầng.

### B. Mỗi môn là một document JSONB — loại

**Ưu:** ít việc nhất, seed chỉ là `INSERT` từng file, đọc gần như bằng 0.
**Nhược:** mất toàn bộ ràng buộc quan hệ; ref Daily chỉ kiểm tra ở tầng app nên
đổi section là ref sai âm thầm — đúng cái footgun cần loại bỏ; sửa một câu phải
đọc/sửa/ghi cả document.

### C. Obsidian là canonical rồi project sang PostgreSQL — chưa chọn

**Ưu:** đúng triết lý ADR-001/002 cho knowledge.
**Nhược:** bridge Obsidian hiện chỉ allowlist Daily; mở rộng nó cho corpus là
một feature lớn hơn nhiều. Có thể xem lại sau, vì projection PostgreSQL đã sẵn.

## Consequences

- **Cơ sở dữ liệu mới cần seed:** sau `npm --prefix server run migrate` phải chạy
  `npm --prefix server run seed:library`, nếu không Library sẽ rỗng.
- Tuyên bố "`content/*.json` là corpus đọc ở server" trong ADR-002 **được thay
  thế cho Library**. Các quy tắc riêng tư của ADR-002 vẫn nguyên hiệu lực: corpus
  không bao giờ vào bundle frontend, mọi route đều server-enforced.
- Corpus giờ là dữ liệu vận hành: sao lưu database là sao lưu nội dung, và bản
  backup `content/*.json` trong repo là điểm khôi phục tự nhiên.
- Level của câu cũ là `null`; muốn phân loại phải làm qua admin panel (phase sau).
- `review_schedules` và các bảng vận hành khác không bị ảnh hưởng.
