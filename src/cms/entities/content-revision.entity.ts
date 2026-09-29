import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import type { CmsContent } from './cms-content.entity.js';
import { User } from '../../users/entities/user.entity.js';

@Entity('content_revisions')
@Unique(['contentId', 'revisionNumber'])
export class ContentRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'content_id' })
  contentId: string;

  @ManyToOne('CmsContent', (content: any) => content.revisions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' })
  content: CmsContent;

  @Column({ type: 'integer', name: 'revision_number' })
  revisionNumber: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  excerpt: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
