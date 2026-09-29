import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { CmsMedia } from './cms-media.entity.js';
import { ContentSeo } from './content-seo.entity.js';
import { ContentRevision } from './content-revision.entity.js';
import { CmsCategory } from './cms-category.entity.js';
import { CmsTag } from './cms-tag.entity.js';

export enum ContentStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

@Entity('contents')
export class CmsContent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  excerpt: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', nullable: true, name: 'featured_media_id' })
  featuredMediaId: string | null;

  @ManyToOne(() => CmsMedia, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'featured_media_id' })
  featuredMedia: CmsMedia | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ContentStatus,
    default: ContentStatus.DRAFT,
  })
  status: ContentStatus;

  @Index()
  @Column({ type: 'timestamp', nullable: true, name: 'published_at' })
  publishedAt: Date | null;

  @OneToOne(() => ContentSeo, (seo) => seo.content, { cascade: true })
  seo: ContentSeo;

  @OneToMany(() => ContentRevision, (revision) => revision.content)
  revisions: ContentRevision[];

  @ManyToMany(() => CmsCategory, (category) => category.contents)
  @JoinTable({
    name: 'content_categories',
    joinColumn: { name: 'content_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: CmsCategory[];

  @ManyToMany(() => CmsTag, (tag) => tag.contents)
  @JoinTable({
    name: 'content_tags',
    joinColumn: { name: 'content_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: CmsTag[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
