# ADR-003: Feed RSS công khai trên trang chủ

**Status:** Accepted
**Date:** 2026-09-12
**Decider:** Đạt

## Context

- Trang chủ Prepify là bề mặt đọc công khai; người dùng muốn thấy tin lập trình mới ngay tại đây.
- Nguồn nội dung là RSS/Atom công khai của bên thứ ba (VnExpress Số hóa, Viblo, TopDev, Hacker News, dev.to).
- Bản quyền là ràng buộc cứng: dịch hoặc đăng lại toàn văn bài của người khác, hay host/nhúng ảnh của họ, đều là tái bản tác phẩm; dẫn nguồn không thay thế việc xin phép.
- Hạ tầng hiện có là một Express process + frontend Vite; không cần thêm dịch vụ ngoài cho phạm vi này.

## Decision

Chọn mô hình **aggregator chỉ dẫn ra ngoài (link-out only), fetch server-side, cache in-memory**.

Nguyên tắc nội dung:

- Chỉ dùng feed RSS/Atom do nguồn phát hành công khai.
- Chỉ hiển thị **tên nguồn + tiêu đề + đoạn trích ngắn + thời gian + link gốc**.
- **Không** tái bản toàn văn và **không** dịch rồi đăng lại bài của người khác.
- **Không** host hay nhúng ảnh của nguồn; hình ảnh trên UI phải do Prepify tự tạo.
- Mọi item mở tab mới về bài gốc với `rel="noopener noreferrer"`.

Nguyên tắc kỹ thuật:

- Endpoint công khai `GET /api/v1/feed?limit=` (mặc định 30, tối đa 50), không yêu cầu đăng nhập — khớp ma trận phân quyền "Home/public feed shell: Read".
- Danh sách nguồn là cấu hình trong mã nguồn: `server/src/modules/feed/sources.ts`.
- Fetch server-side: chỉ `http/https`, timeout 10 giây, tối đa 1 MB mỗi nguồn.
- Parse RSS/Atom, chuẩn hóa, làm sạch đoạn trích (bỏ HTML/markdown, bỏ tiêu đề lặp), dedupe theo URL, sort mới nhất trước.
- Cache in-memory TTL 15 phút kèm single-flight; lỗi một nguồn không làm hỏng cả feed.
- Không lưu nội dung bài viết vào PostgreSQL ở giai đoạn này.

## Consequences

- (+) Không có rủi ro bản quyền cho nội dung và hình ảnh; giữ traffic cho tác giả.
- (+) Không cần migration, không cần thêm hạ tầng; feed vẫn nhanh nhờ cache server và không phụ thuộc CORS của nguồn.
- (+) Thêm/đổi nguồn chỉ là sửa một file cấu hình đã có test bao phủ hành vi service.
- (−) Cache mất khi restart process; không có lịch sử bài để lọc hay xem lại.
- (−) Muốn admin quản lý nguồn hoặc lưu bài thì phải mở ADR mới (DB + phân quyền admin + retention).

## Alternatives considered

- **Client-side fetch qua proxy bên thứ ba:** phụ thuộc dịch vụ ngoài, không cache, vướng CSP/CORS, không quản lý nguồn → loại.
- **Lưu toàn văn + AI tóm tắt/dịch:** nguy cơ bản quyền cao và phình scope, chi phí → loại.

## References

- Design: `docs/superpowers/specs/2026-09-12-home-rss-feed-design.md`
- Plan: `docs/superpowers/plans/2026-09-12-home-rss-feed-implementation.md`
