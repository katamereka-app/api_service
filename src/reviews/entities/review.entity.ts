import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Business } from '../../businesses/entities/business.entity.js';
import type { ReviewReply } from './review-reply.entity.js';

export enum ReviewStatus {
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
  REMOVED = 'REMOVED',
}

@Entity('reviews')
@Unique(['userId', 'businessId'])
@Index(['businessId', 'status'])
@Index(['userId'])
@Index(['rating'])
@Index(['createdAt'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'business_id' })
  businessId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    default: ReviewStatus.PUBLISHED,
  })
  status: ReviewStatus;

  @Column({ type: 'int', default: 0, name: 'helpful_count' })
  helpfulCount: number;

  @OneToOne('ReviewReply', (reply: any) => reply.review)
  reply: ReviewReply | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
