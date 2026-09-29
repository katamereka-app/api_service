import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { CmsContent } from './cms-content.entity.js';
import { CmsMedia } from './cms-media.entity.js';

@Entity('content_seo')
export class ContentSeo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'content_id' })
  contentId: string;

  @OneToOne('CmsContent', (content: any) => content.seo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' })
  content: CmsContent;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'meta_title' })
  metaTitle: string | null;

  @Column({ type: 'text', nullable: true, name: 'meta_description' })
  metaDescription: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'canonical_url' })
  canonicalUrl: string | null;

  @Column({ type: 'boolean', default: true, name: 'robots_index' })
  robotsIndex: boolean;

  @Column({ type: 'boolean', default: true, name: 'robots_follow' })
  robotsFollow: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'og_title' })
  ogTitle: string | null;

  @Column({ type: 'text', nullable: true, name: 'og_description' })
  ogDescription: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'og_media_id' })
  ogMediaId: string | null;

  @ManyToOne(() => CmsMedia, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'og_media_id' })
  ogMedia: CmsMedia | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
