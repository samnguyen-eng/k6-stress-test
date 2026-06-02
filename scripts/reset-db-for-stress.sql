-- Reset reservations + parking spaces before stress test.
-- Run on: parking_db (Cloud SQL Studio / psql)
-- Today: uses CURRENT_DATE for comments only; data reset is date-agnostic.

BEGIN;

-- Optional: worker retry / outbox (nếu còn dùng)
TRUNCATE TABLE worker_message_retries RESTART IDENTITY;
TRUNCATE TABLE outbox_events RESTART IDENTITY;

-- Xóa toàn bộ reservation (1 user/1 ngày constraint được clear)
TRUNCATE TABLE reservations RESTART IDENTITY;

-- Trả tất cả chỗ về AVAILABLE
UPDATE parking_spaces
SET status = 'AVAILABLE',
    updated_at = NOW(),
    updated_by = 'stress-reset'
WHERE is_deleted = FALSE;

COMMIT;

-- Kiểm tra
SELECT status, count(*) FROM parking_spaces GROUP BY status;
SELECT count(*) AS reservation_count FROM reservations;

-- Redis (sau SQL): xóa thêm
--   space:claim:*          (slot claim 30 phút)
--   user:reservation:*     (user/ngày)
--   parking:spaces:all
--   parking:spaces:available
