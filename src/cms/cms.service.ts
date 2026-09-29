import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThanOrEqual, IsNull } from 'typeorm';
import { CmsContent, ContentStatus } from './entities/cms-content.entity.js';
import { ContentSeo } from './entities/content-seo.entity.js';
import { ContentRevision } from './entities/content-revision.entity.js';
import { CmsCategory } from './entities/cms-category.entity.js';
import { CmsTag } from './entities/cms-tag.entity.js';
import { CmsMedia } from './entities/cms-media.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateContentDto } from './dto/create-content.dto.js';
import { UpdateContentDto } from './dto/update-content.dto.js';
import { GetContentsQueryDto } from './dto/get-contents-query.dto.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto.js';
import { StorageService } from '../businesses/storage/storage.service.js';

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

@Injectable()
export class CmsService {
  private readonly logger = new Logger(CmsService.name);

  constructor(
    @InjectRepository(CmsContent)
    private readonly contentRepository: Repository<CmsContent>,
    @InjectRepository(ContentSeo)
    private readonly seoRepository: Repository<ContentSeo>,
    @InjectRepository(ContentRevision)
    private readonly revisionRepository: Repository<ContentRevision>,
    @InjectRepository(CmsCategory)
    private readonly categoryRepository: Repository<CmsCategory>,
    @InjectRepository(CmsTag)
    private readonly tagRepository: Repository<CmsTag>,
    @InjectRepository(CmsMedia)
    private readonly mediaRepository: Repository<CmsMedia>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly storageService: StorageService,
  ) {}

  // ==================== CATEGORIES ====================
  async createCategory(dto: CreateCategoryDto) {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    const existing = await this.categoryRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Kategori dengan slug '${slug}' sudah ada`);
    }

    let parent: CmsCategory | null = null;
    if (dto.parentId) {
      parent = await this.categoryRepository.findOne({ where: { id: dto.parentId } });
      if (!parent) {
        throw new NotFoundException('Parent category tidak ditemukan');
      }
    }

    const category = this.categoryRepository.create({
      name: dto.name,
      slug,
      description: dto.description || null,
      parentId: dto.parentId || null,
    });

    await this.categoryRepository.save(category);
    return {
      success: true,
      message: 'Kategori berhasil dibuat',
      data: category,
    };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Kategori tidak ditemukan');
    }

    if (dto.name) category.name = dto.name;
    if (dto.slug) {
      const slug = slugify(dto.slug);
      const existing = await this.categoryRepository.findOne({ where: { slug } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug '${slug}' sudah digunakan`);
      }
      category.slug = slug;
    }
    if (dto.description !== undefined) category.description = dto.description;
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('Kategori tidak bisa menjadi parent untuk dirinya sendiri');
      }
      category.parentId = dto.parentId;
    }

    await this.categoryRepository.save(category);
    return {
      success: true,
      message: 'Kategori berhasil diperbarui',
      data: category,
    };
  }

  async deleteCategory(id: string) {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Kategori tidak ditemukan');
    }
    await this.categoryRepository.remove(category);
    return {
      success: true,
      message: 'Kategori berhasil dihapus',
    };
  }

  async getCategories() {
    const categories = await this.categoryRepository.find({
      relations: { children: true, parent: true },
      order: { name: 'ASC' },
    });
    return {
      success: true,
      data: categories,
    };
  }

  // ==================== TAGS ====================
  async createTag(dto: CreateTagDto) {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    const existing = await this.tagRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Tag dengan slug '${slug}' sudah ada`);
    }

    const tag = this.tagRepository.create({
      name: dto.name,
      slug,
    });
    await this.tagRepository.save(tag);
    return {
      success: true,
      message: 'Tag berhasil dibuat',
      data: tag,
    };
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    const tag = await this.tagRepository.findOne({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag tidak ditemukan');
    }
    if (dto.name) tag.name = dto.name;
    if (dto.slug) {
      const slug = slugify(dto.slug);
      const existing = await this.tagRepository.findOne({ where: { slug } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug '${slug}' sudah digunakan`);
      }
      tag.slug = slug;
    }
    await this.tagRepository.save(tag);
    return {
      success: true,
      message: 'Tag berhasil diperbarui',
      data: tag,
    };
  }

  async deleteTag(id: string) {
    const tag = await this.tagRepository.findOne({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag tidak ditemukan');
    }
    await this.tagRepository.remove(tag);
    return {
      success: true,
      message: 'Tag berhasil dihapus',
    };
  }

  async getTags() {
    const tags = await this.tagRepository.find({ order: { name: 'ASC' } });
    return {
      success: true,
      data: tags,
    };
  }

  // ==================== MEDIA LIBRARY ====================
  async uploadMedia(user: any, file: Express.Multer.File, altText?: string) {
    if (!file) {
      throw new BadRequestException('File media wajib diunggah');
    }

    const url = await this.storageService.uploadFile(file, 'cms-media');
    const media = this.mediaRepository.create({
      filename: file.filename || file.originalname,
      originalName: file.originalname,
      url,
      mimeType: file.mimetype,
      size: file.size,
      altText: altText || null,
      uploadedById: user.id,
    });

    await this.mediaRepository.save(media);
    return {
      success: true,
      message: 'Media berhasil diunggah',
      data: media,
    };
  }

  async getMediaList() {
    const media = await this.mediaRepository.find({
      relations: { uploadedBy: true },
      order: { createdAt: 'DESC' },
    });
    return {
      success: true,
      data: media.map((m) => ({
        id: m.id,
        filename: m.filename,
        original_name: m.originalName,
        url: m.url,
        mime_type: m.mimeType,
        size: m.size,
        alt_text: m.altText,
        uploaded_by: m.uploadedBy ? { id: m.uploadedBy.id, name: m.uploadedBy.name } : null,
        created_at: m.createdAt,
      })),
    };
  }

  async deleteMedia(id: string) {
    const media = await this.mediaRepository.findOne({ where: { id } });
    if (!media) {
      throw new NotFoundException('Media tidak ditemukan');
    }
    await this.storageService.deleteFile(media.url);
    await this.mediaRepository.remove(media);
    return {
      success: true,
      message: 'Media berhasil dihapus',
    };
  }

  // ==================== CONTENT EDITORIAL & REVISIONS ====================
  async createContent(user: any, dto: CreateContentDto) {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.title);
    const existing = await this.contentRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Konten dengan slug '${slug}' sudah ada`);
    }

    let categories: CmsCategory[] = [];
    if (dto.categoryIds && dto.categoryIds.length > 0) {
      categories = await this.categoryRepository.findBy({ id: In(dto.categoryIds) });
    }

    let tags: CmsTag[] = [];
    if (dto.tagIds && dto.tagIds.length > 0) {
      tags = await this.tagRepository.findBy({ id: In(dto.tagIds) });
    }

    let featuredMedia: CmsMedia | null = null;
    if (dto.featuredMediaId) {
      featuredMedia = await this.mediaRepository.findOne({ where: { id: dto.featuredMediaId } });
    }

    const content = this.contentRepository.create({
      authorId: user.id,
      title: dto.title,
      slug,
      excerpt: dto.excerpt || null,
      body: dto.body,
      featuredMediaId: dto.featuredMediaId || null,
      status: dto.status || ContentStatus.DRAFT,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : (dto.status === ContentStatus.PUBLISHED ? new Date() : null),
      categories,
      tags,
    });

    await this.contentRepository.save(content);

    // Create SEO Entry
    const seoData = dto.seo || {};
    const seo = this.seoRepository.create({
      contentId: content.id,
      metaTitle: seoData.metaTitle || null,
      metaDescription: seoData.metaDescription || null,
      canonicalUrl: seoData.canonicalUrl || null,
      robotsIndex: seoData.robotsIndex ?? true,
      robotsFollow: seoData.robotsFollow ?? true,
      ogTitle: seoData.ogTitle || null,
      ogDescription: seoData.ogDescription || null,
      ogMediaId: seoData.ogMediaId || null,
    });
    await this.seoRepository.save(seo);

    // Create Revision #1
    const revision = this.revisionRepository.create({
      contentId: content.id,
      revisionNumber: 1,
      title: content.title,
      excerpt: content.excerpt,
      body: content.body,
      createdById: user.id,
    });
    await this.revisionRepository.save(revision);

    return {
      success: true,
      message: 'Konten berhasil dibuat',
      data: await this.findOneAdmin(content.id),
    };
  }

  async updateContent(user: any, id: string, dto: UpdateContentDto) {
    const content = await this.contentRepository.findOne({
      where: { id },
      relations: { seo: true, categories: true, tags: true, revisions: true },
    });
    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan');
    }

    if (dto.title) content.title = dto.title;
    if (dto.slug) {
      const slug = slugify(dto.slug);
      const existing = await this.contentRepository.findOne({ where: { slug } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug '${slug}' sudah digunakan`);
      }
      content.slug = slug;
    }
    if (dto.excerpt !== undefined) content.excerpt = dto.excerpt;
    if (dto.body) content.body = dto.body;
    if (dto.featuredMediaId !== undefined) content.featuredMediaId = dto.featuredMediaId;
    if (dto.status) {
      content.status = dto.status;
      if (dto.status === ContentStatus.PUBLISHED && !content.publishedAt) {
        content.publishedAt = new Date();
      }
    }
    if (dto.publishedAt !== undefined) {
      content.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    }

    if (dto.categoryIds) {
      content.categories = await this.categoryRepository.findBy({ id: In(dto.categoryIds) });
    }
    if (dto.tagIds) {
      content.tags = await this.tagRepository.findBy({ id: In(dto.tagIds) });
    }

    await this.contentRepository.save(content);

    // Update SEO
    if (dto.seo) {
      let seo = content.seo;
      if (!seo) {
        seo = this.seoRepository.create({ contentId: content.id });
      }
      if (dto.seo.metaTitle !== undefined) seo.metaTitle = dto.seo.metaTitle;
      if (dto.seo.metaDescription !== undefined) seo.metaDescription = dto.seo.metaDescription;
      if (dto.seo.canonicalUrl !== undefined) seo.canonicalUrl = dto.seo.canonicalUrl;
      if (dto.seo.robotsIndex !== undefined) seo.robotsIndex = dto.seo.robotsIndex;
      if (dto.seo.robotsFollow !== undefined) seo.robotsFollow = dto.seo.robotsFollow;
      if (dto.seo.ogTitle !== undefined) seo.ogTitle = dto.seo.ogTitle;
      if (dto.seo.ogDescription !== undefined) seo.ogDescription = dto.seo.ogDescription;
      if (dto.seo.ogMediaId !== undefined) seo.ogMediaId = dto.seo.ogMediaId;
      await this.seoRepository.save(seo);
    }

    // Create Revision N+1
    const nextRevisionNumber = (content.revisions?.length || 0) + 1;
    const revision = this.revisionRepository.create({
      contentId: content.id,
      revisionNumber: nextRevisionNumber,
      title: content.title,
      excerpt: content.excerpt,
      body: content.body,
      createdById: user.id,
    });
    await this.revisionRepository.save(revision);

    return {
      success: true,
      message: 'Konten berhasil diperbarui',
      data: await this.findOneAdmin(content.id),
    };
  }

  async publishContent(id: string) {
    const content = await this.contentRepository.findOne({ where: { id } });
    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan');
    }
    content.status = ContentStatus.PUBLISHED;
    if (!content.publishedAt) {
      content.publishedAt = new Date();
    }
    await this.contentRepository.save(content);

    return {
      success: true,
      message: 'Konten berhasil dipublikasikan',
      data: content,
    };
  }

  async rollbackRevision(user: any, contentId: string, revisionId: string) {
    const content = await this.contentRepository.findOne({
      where: { id: contentId },
      relations: { revisions: true },
    });
    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan');
    }

    const revision = await this.revisionRepository.findOne({ where: { id: revisionId, contentId } });
    if (!revision) {
      throw new NotFoundException('Revision histori tidak ditemukan');
    }

    content.title = revision.title;
    content.excerpt = revision.excerpt;
    content.body = revision.body;
    await this.contentRepository.save(content);

    // Save rollback action as a new revision entry
    const nextRevisionNumber = (content.revisions?.length || 0) + 1;
    const newRevision = this.revisionRepository.create({
      contentId: content.id,
      revisionNumber: nextRevisionNumber,
      title: content.title,
      excerpt: content.excerpt,
      body: content.body,
      createdById: user.id,
    });
    await this.revisionRepository.save(newRevision);

    return {
      success: true,
      message: `Konten berhasil di-rollback ke Revision #${revision.revisionNumber}`,
      data: await this.findOneAdmin(content.id),
    };
  }

  async deleteContent(id: string) {
    const content = await this.contentRepository.findOne({ where: { id } });
    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan');
    }
    await this.contentRepository.softDelete(id);
    return {
      success: true,
      message: 'Konten berhasil dihapus (soft delete)',
    };
  }

  // ==================== ADMIN QUERIES ====================
  async findAllAdmin(query: GetContentsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.contentRepository.createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .leftJoinAndSelect('c.featuredMedia', 'featuredMedia')
      .leftJoinAndSelect('c.seo', 'seo')
      .leftJoinAndSelect('c.categories', 'categories')
      .leftJoinAndSelect('c.tags', 'tags');

    if (query.search) {
      qb.andWhere('(c.title ILIKE :search OR c.body ILIKE :search OR c.slug ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.status) {
      qb.andWhere('c.status = :status', { status: query.status });
    }

    if (query.categorySlug) {
      qb.andWhere('categories.slug = :categorySlug', { categorySlug: query.categorySlug });
    }

    if (query.tagSlug) {
      qb.andWhere('tags.slug = :tagSlug', { tagSlug: query.tagSlug });
    }

    qb.orderBy('c.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOneAdmin(id: string) {
    const content = await this.contentRepository.findOne({
      where: { id },
      relations: {
        author: true,
        featuredMedia: true,
        seo: { ogMedia: true },
        categories: true,
        tags: true,
        revisions: { createdBy: true },
      },
    });

    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan');
    }

    return content;
  }

  // ==================== PUBLIC ENDPOINTS ====================
  async findAllPublic(query: GetContentsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const now = new Date();

    const qb = this.contentRepository.createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .leftJoinAndSelect('c.featuredMedia', 'featuredMedia')
      .leftJoinAndSelect('c.seo', 'seo')
      .leftJoinAndSelect('seo.ogMedia', 'ogMedia')
      .leftJoinAndSelect('c.categories', 'categories')
      .leftJoinAndSelect('c.tags', 'tags')
      .where('c.status = :status', { status: ContentStatus.PUBLISHED })
      .andWhere('(c.publishedAt IS NULL OR c.publishedAt <= :now)', { now });

    if (query.search) {
      qb.andWhere('(c.title ILIKE :search OR c.excerpt ILIKE :search OR c.body ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.categorySlug) {
      qb.andWhere('categories.slug = :categorySlug', { categorySlug: query.categorySlug });
    }

    if (query.tagSlug) {
      qb.andWhere('tags.slug = :tagSlug', { tagSlug: query.tagSlug });
    }

    qb.orderBy('c.publishedAt', 'DESC');
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items.map((content) => this.formatPublicContent(content)),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findPublicBySlug(slug: string) {
    const now = new Date();
    const content = await this.contentRepository.createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .leftJoinAndSelect('c.featuredMedia', 'featuredMedia')
      .leftJoinAndSelect('c.seo', 'seo')
      .leftJoinAndSelect('seo.ogMedia', 'ogMedia')
      .leftJoinAndSelect('c.categories', 'categories')
      .leftJoinAndSelect('c.tags', 'tags')
      .where('c.slug = :slug', { slug })
      .andWhere('c.status = :status', { status: ContentStatus.PUBLISHED })
      .andWhere('(c.publishedAt IS NULL OR c.publishedAt <= :now)', { now })
      .getOne();

    if (!content) {
      throw new NotFoundException('Konten tidak ditemukan atau belum dipublikasikan');
    }

    return {
      success: true,
      data: this.formatPublicContent(content, true),
    };
  }

  private formatPublicContent(content: CmsContent, fullBody: boolean = false) {
    const seo = content.seo;
    const metaTitle = seo?.metaTitle || content.title;
    const metaDescription = seo?.metaDescription || content.excerpt || '';
    const ogTitle = seo?.ogTitle || metaTitle;
    const ogDescription = seo?.ogDescription || metaDescription;
    const ogImage = seo?.ogMedia?.url || content.featuredMedia?.url || null;

    return {
      id: content.id,
      title: content.title,
      slug: content.slug,
      excerpt: content.excerpt,
      body: fullBody ? content.body : undefined,
      published_at: content.publishedAt,
      author: content.author ? { name: content.author.name } : null,
      featured_image: content.featuredMedia ? { url: content.featuredMedia.url, alt: content.featuredMedia.altText } : null,
      categories: content.categories?.map((c) => ({ name: c.name, slug: c.slug })),
      tags: content.tags?.map((t) => ({ name: t.name, slug: t.slug })),
      seo: {
        meta_title: metaTitle,
        meta_description: metaDescription,
        canonical_url: seo?.canonicalUrl || null,
        robots_index: seo?.robotsIndex ?? true,
        robots_follow: seo?.robotsFollow ?? true,
        og_title: ogTitle,
        og_description: ogDescription,
        og_image: ogImage,
      },
    };
  }
}
