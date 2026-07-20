-- ═══════════════════════════════════════════════════════════════════
-- SAFE, READ-ONLY audit of historical attendance records that MAY have
-- been mislabelled as LATE by the pre-fix `checkIn()` behaviour, which
-- silently flipped status to LATE whenever the check-in time was
-- > 08:05 wall-clock — even when the operator only clicked "حضور".
--
-- This script performs NO writes. It only lists rows for you to review.
-- Do NOT run any UPDATE / DELETE until you have confirmed each record
-- is truly mislabelled.
--
-- Heuristic:
--   • status = 'LATE'
--   • lateMin > 0
--   • record has a checkIn timestamp (which the buggy code always set)
--   • lateMin equals exactly max(0, floor((checkIn - shiftStart)/60) - 5)
--     when shiftStart = date @ 08:00 — i.e. the value matches the
--     buggy formula EXACTLY. Manually-entered LATE marks usually have
--     lateMin = 0 (or a round number typed by the operator).
--
-- Suggested workflow AFTER you review the results:
--   1) SELECT COUNT(*) to gauge scope.
--   2) Sample 5–10 rows manually against attendance logs to confirm.
--   3) Only then run a targeted UPDATE — I will draft it separately
--      and it will be idempotent + fully audited.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Rows currently marked LATE that look formulaic (auto-generated)
SELECT
  ar.id,
  ar."tenantId",
  ar."employeeId",
  e."fullName",
  ar.date,
  ar."checkIn",
  ar."checkOut",
  ar."lateMin"      AS stored_late_min,
  -- Recompute what the buggy formula WOULD have produced:
  GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (ar."checkIn" - (date_trunc('day', ar.date) + interval '8 hour'))) / 60)::int - 5
  )                  AS formula_late_min,
  ar.status
FROM "AttendanceRecord" ar
JOIN "Employee" e ON e.id = ar."employeeId"
WHERE ar.status = 'LATE'
  AND ar."lateMin" > 0
  AND ar."checkIn" IS NOT NULL
  AND ar."lateMin" = GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (ar."checkIn" - (date_trunc('day', ar.date) + interval '8 hour'))) / 60)::int - 5
      )
ORDER BY ar.date DESC, e."fullName"
LIMIT 500;

-- 2) Count-by-month for scope check
SELECT
  date_trunc('month', ar.date) AS month,
  COUNT(*) AS suspicious_late_rows
FROM "AttendanceRecord" ar
WHERE ar.status = 'LATE'
  AND ar."lateMin" > 0
  AND ar."checkIn" IS NOT NULL
  AND ar."lateMin" = GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (ar."checkIn" - (date_trunc('day', ar.date) + interval '8 hour'))) / 60)::int - 5
      )
GROUP BY 1
ORDER BY 1 DESC;

-- 3) Count of manually-entered LATE marks (probably legitimate)
--    → lateMin is 0 (the "LATE" button never sets lateMin)
SELECT COUNT(*) AS manual_late_marks
FROM "AttendanceRecord"
WHERE status = 'LATE' AND ("lateMin" = 0 OR "lateMin" IS NULL);
