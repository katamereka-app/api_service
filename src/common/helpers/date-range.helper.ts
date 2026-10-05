import { BadRequestException } from '@nestjs/common';

export type DateRangeKey = '7d' | '30d' | '3m' | '1y' | 'all';

export interface DateRangeResult {
  key: DateRangeKey;
  from: Date | null;
  to: Date | null;
  prevFrom: Date | null;
  prevTo: Date | null;
  fromIso: string | null;
  toIso: string | null;
}

/**
 * Format Date object into ISO string with WIB timezone (+07:00)
 */
export function formatWibIso(date: Date | null): string | null {
  if (!date) return null;
  // WIB is UTC+7 (7 hours = 420 minutes)
  const wibTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const iso = wibTime.toISOString(); // e.g. 2026-10-02T16:59:59.999Z
  return iso.replace('Z', '+07:00');
}

/**
 * Resolve date range query parameter into JavaScript Date boundaries (Asia/Jakarta / WIB)
 */
export function resolveRange(rangeStr?: string | null, referenceDate?: Date): DateRangeResult {
  const keyStr = (rangeStr || 'all').toLowerCase().trim();

  if (!['7d', '30d', '3m', '1y', 'all'].includes(keyStr)) {
    throw new BadRequestException('Parameter range tidak valid. Pilihan valid: 7d, 30d, 3m, 1y, atau all');
  }

  const key = keyStr as DateRangeKey;

  if (key === 'all') {
    return {
      key: 'all',
      from: null,
      to: null,
      prevFrom: null,
      prevTo: null,
      fromIso: null,
      toIso: null,
    };
  }

  const now = referenceDate ? new Date(referenceDate) : new Date();

  // Convert `now` to WIB components
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffsetMs);

  const year = wibNow.getUTCFullYear();
  const month = wibNow.getUTCMonth();
  const day = wibNow.getUTCDate();

  // End of current day in WIB (23:59:59.999+07:00)
  const to = new Date(Date.UTC(year, month, day, 16, 59, 59, 999)); // 23:59:59 WIB is 16:59:59 UTC

  let daysCount = 30;
  if (key === '7d') daysCount = 7;
  else if (key === '30d') daysCount = 30;
  else if (key === '3m') daysCount = 90;
  else if (key === '1y') daysCount = 365;

  // Start of range in WIB (00:00:00.000+07:00)
  const from = new Date(to.getTime() - (daysCount * 24 * 60 * 60 * 1000) + 1);
  // Set from to 00:00:00.000 WIB
  const fromWibDate = new Date(to.getTime() + wibOffsetMs - (daysCount - 1) * 24 * 60 * 60 * 1000);
  const fromYear = fromWibDate.getUTCFullYear();
  const fromMonth = fromWibDate.getUTCMonth();
  const fromDay = fromWibDate.getUTCDate();
  
  const fromDate = new Date(Date.UTC(fromYear, fromMonth, fromDay, -7, 0, 0, 0)); // 00:00:00 WIB is 17:00:00 UTC previous day (-7h)

  // Previous period
  const prevTo = new Date(fromDate.getTime() - 1); // 23:59:59.999 WIB of previous day
  const prevFromDate = new Date(Date.UTC(fromYear, fromMonth, fromDay - daysCount, -7, 0, 0, 0));

  return {
    key,
    from: fromDate,
    to,
    prevFrom: prevFromDate,
    prevTo,
    fromIso: formatWibIso(fromDate),
    toIso: formatWibIso(to),
  };
}
