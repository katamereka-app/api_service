import { Injectable, Logger } from '@nestjs/common';
import openingHoursLib from 'opening_hours';
import { WeeklyScheduleItem } from './entities/business-operating-hours.entity.js';

export interface OperatingHoursResult {
  isOpen: boolean | null;
  statusText: string;
  rawSchedule: string | null;
  source: 'geoapify_osm' | 'google_places' | 'unknown';
  nextChangeText: string | null;
  weeklySchedule: WeeklyScheduleItem[];
}

const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

@Injectable()
export class OperatingHoursService {
  private readonly logger = new Logger(OperatingHoursService.name);

  /**
   * Parse Google Places opening_hours object (periods / weekday_text)
   */
  parseGoogleOpeningHoursObject(
    googleHours: any,
    timezone: string = 'Asia/Jakarta',
  ): OperatingHoursResult {
    if (!googleHours || typeof googleHours !== 'object') {
      return {
        isOpen: null,
        statusText: 'Jam Operasional Tidak Tersedia',
        rawSchedule: null,
        source: 'unknown',
        nextChangeText: null,
        weeklySchedule: this.buildDefaultClosedWeeklySchedule(),
      };
    }

    const isOpen = typeof googleHours.open_now === 'boolean' ? googleHours.open_now : null;
    let statusText = isOpen === true ? 'Buka Sekarang' : (isOpen === false ? 'Tutup' : 'Jam Operasional Tidak Tersedia');

    // Check if 24 hours
    const weekdayText: string[] = googleHours.weekday_text || [];
    const is24Hours = weekdayText.some((t) => t.toLowerCase().includes('open 24 hours') || t.toLowerCase().includes('24 jam'));
    if (is24Hours) {
      return {
        isOpen: true,
        statusText: 'Buka 24 Jam',
        rawSchedule: weekdayText.join('; '),
        source: 'google_places',
        nextChangeText: null,
        weeklySchedule: this.build24HourWeeklySchedule(),
      };
    }

    const weeklySchedule: WeeklyScheduleItem[] = DAY_NAMES_ID.map((dayName, dayIndex) => ({
      dayIndex,
      dayName,
      timeRange: 'Tutup',
      isClosed: true,
    }));

    if (googleHours.periods && Array.isArray(googleHours.periods)) {
      for (const p of googleHours.periods) {
        const dayIdx = p.open?.day;
        if (dayIdx !== undefined && dayIdx >= 0 && dayIdx < 7) {
          const openTime = p.open?.time ? `${p.open.time.slice(0, 2)}:${p.open.time.slice(2)}` : '';
          const closeTime = p.close?.time ? `${p.close.time.slice(0, 2)}:${p.close.time.slice(2)}` : '';
          const timeRange = openTime && closeTime ? `${openTime} - ${closeTime}` : (openTime ? `Buka dari ${openTime}` : 'Buka');

          weeklySchedule[dayIdx] = {
            dayIndex: dayIdx,
            dayName: DAY_NAMES_ID[dayIdx],
            timeRange,
            isClosed: false,
          };
        }
      }
    } else if (weekdayText.length > 0) {
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
        minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6,
      };

      for (const line of weekdayText) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const dayStr = parts[0].trim().toLowerCase();
          const timeStr = parts.slice(1).join(':').trim();
          const targetDayIdx = dayMap[dayStr];

          if (targetDayIdx !== undefined) {
            const isClosedLine = timeStr.toLowerCase().includes('closed') || timeStr.toLowerCase().includes('tutup');
            weeklySchedule[targetDayIdx] = {
              dayIndex: targetDayIdx,
              dayName: DAY_NAMES_ID[targetDayIdx],
              timeRange: isClosedLine ? 'Tutup' : timeStr,
              isClosed: isClosedLine,
            };
          }
        }
      }
    }

    return {
      isOpen,
      statusText,
      rawSchedule: weekdayText.length > 0 ? weekdayText.join('; ') : JSON.stringify(googleHours),
      source: 'google_places',
      nextChangeText: null,
      weeklySchedule,
    };
  }

  /**
   * Parse opening_hours string (OSM / Geoapify / Google) & calculate realtime status
   */
  parseAndCalculate(
    rawSchedule: string | null | undefined,
    source: 'geoapify_osm' | 'google_places' | 'unknown' = 'unknown',
    timezone: string = 'Asia/Jakarta',
  ): OperatingHoursResult {
    // 1. Handling data NULL / Undefined / Kosong
    if (!rawSchedule || typeof rawSchedule !== 'string' || rawSchedule.trim() === '') {
      return {
        isOpen: null,
        statusText: 'Jam Operasional Tidak Tersedia',
        rawSchedule: null,
        source: 'unknown',
        nextChangeText: null,
        weeklySchedule: this.buildDefaultClosedWeeklySchedule(),
      };
    }

    const cleanSchedule = rawSchedule.trim();

    // 2. Handling Buka 24 Jam (24/7)
    if (this.is24HourSchedule(cleanSchedule)) {
      return {
        isOpen: true,
        statusText: 'Buka 24 Jam',
        rawSchedule: cleanSchedule,
        source,
        nextChangeText: null,
        weeklySchedule: this.build24HourWeeklySchedule(),
      };
    }

    // 3. Try parsing via official `opening_hours` NPM package
    try {
      // opening_hours constructor requires nominating nominal location coordinates or country
      // We pass nominator options with default fallback coordinates if needed
      const oh = new (openingHoursLib as any)(cleanSchedule, null, {
        warnings_severity: 7,
      });

      const now = new Date();
      const isOpen = oh.getState(now);
      const nextChange = oh.getNextChange(now);

      let statusText = isOpen ? 'Buka Sekarang' : 'Tutup';
      let nextChangeText: string | null = null;

      if (nextChange) {
        const changeTimeStr = nextChange.toLocaleTimeString('id-ID', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        if (isOpen) {
          // Cek jika akan tutup dalam 1 jam (Segera Tutup)
          const diffMinutes = Math.floor((nextChange.getTime() - now.getTime()) / (1000 * 60));
          if (diffMinutes <= 60 && diffMinutes > 0) {
            statusText = 'Segera Tutup';
          }
          nextChangeText = `Tutup pukul ${changeTimeStr}`;
        } else {
          const isToday = nextChange.getDate() === now.getDate();
          if (isToday) {
            nextChangeText = `Buka kembali pukul ${changeTimeStr}`;
          } else {
            const nextDayName = DAY_NAMES_ID[nextChange.getDay()];
            nextChangeText = `Buka ${nextDayName} pukul ${changeTimeStr}`;
          }
        }
      }

      // Generate 7-day Weekly Schedule
      const weeklySchedule = this.generateWeeklyScheduleFromLib(oh, now);

      return {
        isOpen,
        statusText,
        rawSchedule: cleanSchedule,
        source,
        nextChangeText,
        weeklySchedule,
      };
    } catch (err) {
      this.logger.warn(`Gagal parse string OSM "${cleanSchedule}" dengan library opening_hours, mencoba fallback custom parser: ${err}`);
      return this.parseCustomFallback(cleanSchedule, source);
    }
  }

  private is24HourSchedule(str: string): boolean {
    const s = str.toLowerCase();
    return s === '24/7' || s === '24/7 open' || s === '24 hours' || s === 'open 24 hours' || s === '24 jam';
  }

  private buildDefaultClosedWeeklySchedule(): WeeklyScheduleItem[] {
    return DAY_NAMES_ID.map((dayName, dayIndex) => ({
      dayIndex,
      dayName,
      timeRange: 'Jam tidak tersedia',
      isClosed: true,
    }));
  }

  private build24HourWeeklySchedule(): WeeklyScheduleItem[] {
    return DAY_NAMES_ID.map((dayName, dayIndex) => ({
      dayIndex,
      dayName,
      timeRange: '24 Jam',
      isClosed: false,
    }));
  }

  private generateWeeklyScheduleFromLib(oh: any, baseDate: Date): WeeklyScheduleItem[] {
    const result: WeeklyScheduleItem[] = [];

    // Iterate dayIndex 0 (Minggu) .. 6 (Sabtu)
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayName = DAY_NAMES_ID[dayIndex];
      try {
        // Find next date matching dayIndex
        const targetDate = new Date(baseDate);
        const currentDay = targetDate.getDay();
        const diff = dayIndex - currentDay;
        targetDate.setDate(targetDate.getDate() + diff);
        targetDate.setHours(12, 0, 0, 0);

        const intervals = oh.getOpenIntervals(
          new Date(targetDate.setHours(0, 0, 0, 0)),
          new Date(targetDate.setHours(23, 59, 59, 999)),
        );

        if (!intervals || intervals.length === 0) {
          result.push({
            dayIndex,
            dayName,
            timeRange: 'Tutup',
            isClosed: true,
          });
        } else {
          const ranges = intervals.map(([start, end]: [Date, Date]) => {
            const startStr = start.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
            const endStr = end.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
            return `${startStr} - ${endStr}`;
          });
          result.push({
            dayIndex,
            dayName,
            timeRange: ranges.join(', '),
            isClosed: false,
          });
        }
      } catch (err) {
        result.push({
          dayIndex,
          dayName,
          timeRange: 'Tutup',
          isClosed: true,
        });
      }
    }

    return result;
  }

  /**
   * Fallback custom parser for non-standard or malformed opening hours strings
   */
  private parseCustomFallback(str: string, source: 'geoapify_osm' | 'google_places' | 'unknown'): OperatingHoursResult {
    // Regex match format standar sederha "HH:MM - HH:MM" atau "Mo-Fr 08:00-22:00"
    const timeMatch = str.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    if (timeMatch) {
      const [_, startTime, endTime] = timeMatch;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      const isOpen = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      const statusText = isOpen ? 'Buka Sekarang' : 'Tutup';
      const nextChangeText = isOpen ? `Tutup pukul ${endTime}` : `Buka pukul ${startTime}`;

      const weeklySchedule = DAY_NAMES_ID.map((dayName, dayIndex) => ({
        dayIndex,
        dayName,
        timeRange: `${startTime} - ${endTime}`,
        isClosed: false,
      }));

      return {
        isOpen,
        statusText,
        rawSchedule: str,
        source,
        nextChangeText,
        weeklySchedule,
      };
    }

    return {
      isOpen: null,
      statusText: 'Jam Operasional Tidak Tersedia',
      rawSchedule: str,
      source,
      nextChangeText: null,
      weeklySchedule: this.buildDefaultClosedWeeklySchedule(),
    };
  }
}
