import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Business } from './business.entity.js';

export interface WeeklyScheduleItem {
  dayIndex: number; // 0 = Minggu, 1 = Senin, 2 = Selasa, dst.
  dayName: string;
  timeRange: string; // "08:00 - 22:00", "24 Jam", "Tutup"
  isClosed: boolean;
}

@Entity('business_operating_hours')
export class BusinessOperatingHours {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'business_id', unique: true })
  @Index()
  businessId: string;

  @OneToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ type: 'boolean', nullable: true, name: 'is_open' })
  isOpen: boolean | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'status_text' })
  statusText: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'next_change_text' })
  nextChangeText: string | null;

  @Column({ type: 'text', nullable: true, name: 'raw_schedule' })
  rawSchedule: string | null;

  @Column({ type: 'varchar', length: 50, default: 'unknown' })
  source: 'geoapify_osm' | 'google_places' | 'unknown';

  @Column({ type: 'jsonb', nullable: true, name: 'weekly_schedule' })
  weeklySchedule: WeeklyScheduleItem[] | null;

  @Column({ type: 'varchar', length: 100, default: 'Asia/Jakarta' })
  timezone: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
