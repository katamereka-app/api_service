import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Review, ReviewStatus } from './entities/review.entity.js';
import { ReviewReply } from './entities/review-reply.entity.js';
import { Business } from '../businesses/entities/business.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { GetReviewsQueryDto, ReviewSortOption } from './dto/get-reviews-query.dto.js';
import { DashboardReviewsQueryDto, ReplyStatusFilter } from './dto/dashboard-reviews-query.dto.js';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto.js';
import { UpdateReviewReplyDto } from './dto/update-review-reply.dto.js';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(ReviewReply)
    private readonly replyRepository: Repository<ReviewReply>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async createReview(userId: string, businessId: string, dto: CreateReviewDto) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const existing = await this.reviewRepository.findOne({
      where: { userId, businessId },
    });
    if (existing) {
      throw new ConflictException('Anda sudah memberikan ulasan untuk bisnis ini. Silakan perbarui ulasan Anda.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const review = queryRunner.manager.create(Review, {
        userId,
        businessId,
        rating: dto.rating,
        title: dto.title || null,
        content: dto.content,
        status: ReviewStatus.PUBLISHED,
      });

      await queryRunner.manager.save(review);
      await this.recalculateBusinessRating(businessId, queryRunner.manager);

      await queryRunner.commitTransaction();

      const savedReview = await this.reviewRepository.findOne({
        where: { id: review.id },
        relations: { user: true },
      });

      return {
        success: true,
        message: 'Review berhasil dibuat',
        data: {
          id: savedReview?.id,
          business_id: savedReview?.businessId,
          rating: savedReview?.rating,
          title: savedReview?.title,
          content: savedReview?.content,
          status: savedReview?.status,
          user: {
            id: savedReview?.user?.id,
            name: savedReview?.user?.name,
          },
          created_at: savedReview?.createdAt,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to create review for business ${businessId}:`, err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findBusinessReviews(businessId: string, query: GetReviewsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.reviewRepository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.user', 'user')
      .leftJoinAndSelect('review.reply', 'reply')
      .leftJoinAndSelect('reply.author', 'author')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (query.rating) {
      queryBuilder.andWhere('review.rating = :rating', { rating: query.rating });
    }

    switch (query.sort) {
      case ReviewSortOption.OLDEST:
        queryBuilder.orderBy('review.createdAt', 'ASC');
        break;
      case ReviewSortOption.HIGHEST:
        queryBuilder.orderBy('review.rating', 'DESC').addOrderBy('review.createdAt', 'DESC');
        break;
      case ReviewSortOption.LOWEST:
        queryBuilder.orderBy('review.rating', 'ASC').addOrderBy('review.createdAt', 'DESC');
        break;
      case ReviewSortOption.NEWEST:
      default:
        queryBuilder.orderBy('review.createdAt', 'DESC');
        break;
    }

    queryBuilder.skip(skip).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      data: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        content: r.content,
        created_at: r.createdAt,
        user: {
          id: r.user?.id,
          name: r.user?.name,
        },
        business_reply: r.reply
          ? {
              id: r.reply.id,
              content: r.reply.content,
              created_at: r.reply.createdAt,
              author: r.reply.author
                ? {
                    id: r.reply.author.id,
                    name: r.reply.author.name,
                  }
                : null,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }

  async getReviewSummary(businessId: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const distResult = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.rating', 'rating')
      .addSelect('COUNT(review.id)', 'count')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
      .groupBy('review.rating')
      .getRawMany();

    const distribution: Record<string, number> = {
      '5': 0,
      '4': 0,
      '3': 0,
      '2': 0,
      '1': 0,
    };

    let totalReviewCount = 0;
    let sumRating = 0;

    for (const row of distResult) {
      const r = row.rating?.toString();
      const cnt = parseInt(row.count, 10);
      if (distribution[r] !== undefined) {
        distribution[r] = cnt;
      }
      totalReviewCount += cnt;
      sumRating += (parseInt(row.rating, 10) * cnt);
    }

    const avgRating = totalReviewCount > 0 ? parseFloat((sumRating / totalReviewCount).toFixed(1)) : 0;

    return {
      average_rating: avgRating,
      review_count: totalReviewCount,
      distribution,
    };
  }

  async findOne(reviewId: string) {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
      relations: { user: true, reply: { author: true } },
    });

    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan');
    }

    return {
      id: review.id,
      business_id: review.businessId,
      rating: review.rating,
      title: review.title,
      content: review.content,
      status: review.status,
      user: {
        id: review.user?.id,
        name: review.user?.name,
      },
      business_reply: review.reply
        ? {
            id: review.reply.id,
            content: review.reply.content,
            created_at: review.reply.createdAt,
            author: review.reply.author
              ? {
                  id: review.reply.author.id,
                  name: review.reply.author.name,
                }
              : null,
          }
        : null,
      created_at: review.createdAt,
      updated_at: review.updatedAt,
    };
  }

  async updateReview(userId: string, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan');
    }

    if (review.userId !== userId) {
      throw new ForbiddenException('Anda hanya dapat mengubah ulasan milik sendiri');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (dto.rating !== undefined) review.rating = dto.rating;
      if (dto.title !== undefined) review.title = dto.title;
      if (dto.content !== undefined) review.content = dto.content;

      await queryRunner.manager.save(review);
      await this.recalculateBusinessRating(review.businessId, queryRunner.manager);

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Review berhasil diperbarui',
        data: review,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async deleteReview(userId: string, reviewId: string) {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan');
    }

    if (review.userId !== userId) {
      throw new ForbiddenException('Anda hanya dapat menghapus ulasan milik sendiri');
    }

    const businessId = review.businessId;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.remove(review);
      await this.recalculateBusinessRating(businessId, queryRunner.manager);

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Review berhasil dihapus',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async recalculateBusinessRating(businessId: string, entityManager?: EntityManager) {
    const manager = entityManager || this.dataSource.manager;

    const result = await manager
      .createQueryBuilder(Review, 'review')
      .select('AVG(review.rating)', 'avg')
      .addSelect('COUNT(review.id)', 'count')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
      .getRawOne();

    const avgRating = result?.avg ? parseFloat(parseFloat(result.avg).toFixed(2)) : null;
    const reviewCount = result?.count ? parseInt(result.count, 10) : 0;

    await manager.update(Business, { id: businessId }, {
      averageRating: avgRating,
      reviewCount: reviewCount,
    });
  }

  async getDashboardReviews(businessId: string, query: DashboardReviewsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.reviewRepository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.user', 'user')
      .leftJoinAndSelect('review.reply', 'reply')
      .leftJoinAndSelect('reply.author', 'author')
      .where('review.businessId = :businessId', { businessId });

    if (query.rating) {
      queryBuilder.andWhere('review.rating = :rating', { rating: query.rating });
    }

    if (query.reply_status === ReplyStatusFilter.REPLIED) {
      queryBuilder.andWhere('reply.id IS NOT NULL');
    } else if (query.reply_status === ReplyStatusFilter.UNREPLIED) {
      queryBuilder.andWhere('reply.id IS NULL');
    }

    switch (query.sort) {
      case ReviewSortOption.OLDEST:
        queryBuilder.orderBy('review.createdAt', 'ASC');
        break;
      case ReviewSortOption.HIGHEST:
        queryBuilder.orderBy('review.rating', 'DESC').addOrderBy('review.createdAt', 'DESC');
        break;
      case ReviewSortOption.LOWEST:
        queryBuilder.orderBy('review.rating', 'ASC').addOrderBy('review.createdAt', 'DESC');
        break;
      case ReviewSortOption.NEWEST:
      default:
        queryBuilder.orderBy('review.createdAt', 'DESC');
        break;
    }

    queryBuilder.skip(skip).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      data: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        content: r.content,
        status: r.status,
        created_at: r.createdAt,
        user: {
          id: r.user?.id,
          name: r.user?.name,
        },
        reply: r.reply
          ? {
              id: r.reply.id,
              content: r.reply.content,
              created_at: r.reply.createdAt,
              author: r.reply.author
                ? {
                    id: r.reply.author.id,
                    name: r.reply.author.name,
                  }
                : null,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }

  async createBusinessReply(
    authorUserId: string,
    businessId: string,
    reviewId: string,
    dto: CreateReviewReplyDto,
  ) {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId, businessId } });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan di bisnis ini');
    }

    const existingReply = await this.replyRepository.findOne({ where: { reviewId } });
    if (existingReply) {
      throw new ConflictException('Ulasan ini sudah memiliki balasan resmi. Silakan perbarui balasan yang ada.');
    }

    const reply = this.replyRepository.create({
      reviewId,
      businessId,
      authorUserId,
      content: dto.content,
    });

    await this.replyRepository.save(reply);

    const savedReply = await this.replyRepository.findOne({
      where: { id: reply.id },
      relations: { author: true },
    });

    return {
      success: true,
      message: 'Balasan berhasil dikirim',
      data: {
        id: savedReply?.id,
        review_id: savedReply?.reviewId,
        content: savedReply?.content,
        author: {
          id: savedReply?.author?.id,
          name: savedReply?.author?.name,
        },
        created_at: savedReply?.createdAt,
      },
    };
  }

  async updateBusinessReply(
    authorUserId: string,
    businessId: string,
    reviewId: string,
    dto: UpdateReviewReplyDto,
  ) {
    const reply = await this.replyRepository.findOne({ where: { reviewId, businessId } });
    if (!reply) {
      throw new NotFoundException('Balasan tidak ditemukan');
    }

    reply.content = dto.content;
    reply.authorUserId = authorUserId;
    await this.replyRepository.save(reply);

    return {
      success: true,
      message: 'Balasan berhasil diperbarui',
      data: reply,
    };
  }

  async deleteBusinessReply(authorUserId: string, businessId: string, reviewId: string) {
    const reply = await this.replyRepository.findOne({ where: { reviewId, businessId } });
    if (!reply) {
      throw new NotFoundException('Balasan tidak ditemukan');
    }

    await this.replyRepository.remove(reply);

    return {
      success: true,
      message: 'Balasan berhasil dihapus',
    };
  }

  async getMyReviews(userId: string) {
    const reviews = await this.reviewRepository.find({
      where: { userId },
      relations: { business: true },
      order: { createdAt: 'DESC' },
    });

    const data = reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      content: review.content,
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      business: review.business
        ? {
            id: review.business.id,
            name: review.business.name,
            slug: review.business.slug,
            category: review.business.category,
            address: review.business.address,
            city: review.business.city,
            logoUrl: review.business.logoUrl,
          }
        : null,
    }));

    return {
      success: true,
      message: 'Berhasil mengambil ulasan milik pengguna',
      data,
    };
  }
}

