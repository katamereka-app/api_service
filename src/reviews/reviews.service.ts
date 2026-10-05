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
import { ReviewHelpful } from './entities/review-helpful.entity.js';
import { ReviewReport } from '../review-reports/entities/review-report.entity.js';
import { ReviewReportStatus } from '../review-reports/enums/review-report-status.enum.js';
import { Business } from '../businesses/entities/business.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { GetReviewsQueryDto, ReviewSortOption } from './dto/get-reviews-query.dto.js';
import { DashboardReviewsQueryDto, ReplyStatusFilter } from './dto/dashboard-reviews-query.dto.js';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto.js';
import { UpdateReviewReplyDto } from './dto/update-review-reply.dto.js';
import { resolveRange, formatWibIso } from '../common/helpers/date-range.helper.js';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(ReviewReply)
    private readonly replyRepository: Repository<ReviewReply>,
    @InjectRepository(ReviewHelpful)
    private readonly helpfulRepository: Repository<ReviewHelpful>,
    @InjectRepository(ReviewReport)
    private readonly reviewReportRepository: Repository<ReviewReport>,
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

  async getReviewSummary(businessId: string, range?: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const rangeRes = resolveRange(range);

    const qb = this.reviewRepository
      .createQueryBuilder('review')
      .select('review.rating', 'rating')
      .addSelect('COUNT(review.id)', 'count')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (rangeRes.from && rangeRes.to) {
      qb.andWhere('review.createdAt >= :from AND review.createdAt <= :to', {
        from: rangeRes.from,
        to: rangeRes.to,
      });
    }

    const distResult = await qb.groupBy('review.rating').getRawMany();

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
      ...(rangeRes.key !== 'all' ? { range: rangeRes.key } : {}),
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

    if (query.verified === true) {
      queryBuilder.andWhere('user.email_verified_at IS NOT NULL');
    } else if (query.verified === false) {
      queryBuilder.andWhere('user.email_verified_at IS NULL');
    }

    if (query.source) {
      queryBuilder.andWhere('review.source = :source', { source: query.source });
    }

    if (query.search) {
      queryBuilder.andWhere('(review.content ILIKE :search OR user.name ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.reported) {
      queryBuilder.andWhere(
        `EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = review.id AND rr.status = :reportedStatus)`,
        { reportedStatus: ReviewReportStatus.PENDING },
      );
    }

    if (query.needs_attention === true) {
      queryBuilder.andWhere(
        `(reply.id IS NULL OR review.rating <= 2 OR EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = review.id AND rr.status = :pendingReportStatus))`,
        { pendingReportStatus: ReviewReportStatus.PENDING },
      );
    }

    if (query.range && query.range !== 'all') {
      const rangeRes = resolveRange(query.range);
      if (rangeRes.from && rangeRes.to) {
        queryBuilder.andWhere('review.createdAt >= :rangeFrom AND review.createdAt <= :rangeTo', {
          rangeFrom: rangeRes.from,
          rangeTo: rangeRes.to,
        });
      }
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

    const reviewIds = items.map((r) => r.id);
    const reportCountByReview = new Map<string, number>();
    if (reviewIds.length > 0) {
      const counts = await this.reviewReportRepository
        .createQueryBuilder('report')
        .select('report.reviewId', 'reviewId')
        .addSelect('COUNT(*)', 'count')
        .where('report.reviewId IN (:...reviewIds)', { reviewIds })
        .andWhere('report.status = :status', { status: ReviewReportStatus.PENDING })
        .groupBy('report.reviewId')
        .getRawMany();
      for (const row of counts) {
        reportCountByReview.set(row.reviewId, parseInt(row.count, 10));
      }
    }

    return {
      data: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        content: r.content,
        status: r.status,
        source: r.source,
        is_verified: !!r.user?.emailVerifiedAt,
        report_count: reportCountByReview.get(r.id) ?? 0,
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

  async toggleHelpful(userId: string, reviewId: string) {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan');
    }

    const existingVote = await this.helpfulRepository.findOne({
      where: { reviewId, userId },
    });

    if (existingVote) {
      // Unlike (batal vote helpful)
      await this.helpfulRepository.remove(existingVote);
      review.helpfulCount = Math.max(0, (review.helpfulCount || 0) - 1);
      await this.reviewRepository.save(review);

      return {
        success: true,
        message: 'Vote helpful berhasil dihapus',
        isHelpful: false,
        helpfulCount: review.helpfulCount,
      };
    } else {
      // Like (tambah vote helpful)
      const newVote = this.helpfulRepository.create({ reviewId, userId });
      await this.helpfulRepository.save(newVote);
      review.helpfulCount = (review.helpfulCount || 0) + 1;
      await this.reviewRepository.save(review);

      return {
        success: true,
        message: 'Vote helpful berhasil ditambahkan',
        isHelpful: true,
        helpfulCount: review.helpfulCount,
      };
    }
  }

  async getDashboardOverview(businessId: string, rangeStr?: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const rangeRes = resolveRange(rangeStr || '30d');
    const isAll = rangeRes.key === 'all';

    // 1. AVERAGE RATING & RATING DISTRIBUTION in current period
    const currentDistQb = this.reviewRepository
      .createQueryBuilder('review')
      .select('review.rating', 'rating')
      .addSelect('COUNT(review.id)', 'count')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (!isAll && rangeRes.from && rangeRes.to) {
      currentDistQb.andWhere('review.createdAt >= :from AND review.createdAt <= :to', {
        from: rangeRes.from,
        to: rangeRes.to,
      });
    }

    const currentDist = await currentDistQb.groupBy('review.rating').getRawMany();

    const ratingDistribution: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    let currentPeriodReviewCount = 0;
    let currentPeriodSumRating = 0;

    for (const row of currentDist) {
      const r = row.rating?.toString();
      const cnt = parseInt(row.count, 10);
      if (ratingDistribution[r] !== undefined) {
        ratingDistribution[r] = cnt;
      }
      currentPeriodReviewCount += cnt;
      currentPeriodSumRating += parseInt(row.rating, 10) * cnt;
    }

    const currentAvgRating = currentPeriodReviewCount > 0
      ? parseFloat((currentPeriodSumRating / currentPeriodReviewCount).toFixed(1))
      : 0;

    // Previous period average rating
    let prevAvgRating: number | null = null;
    let deltaRating: number | null = null;

    if (!isAll && rangeRes.prevFrom && rangeRes.prevTo) {
      const prevDist = await this.reviewRepository
        .createQueryBuilder('review')
        .select('review.rating', 'rating')
        .addSelect('COUNT(review.id)', 'count')
        .where('review.businessId = :businessId', { businessId })
        .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
        .andWhere('review.createdAt >= :prevFrom AND review.createdAt <= :prevTo', {
          prevFrom: rangeRes.prevFrom,
          prevTo: rangeRes.prevTo,
        })
        .groupBy('review.rating')
        .getRawMany();

      let prevCount = 0;
      let prevSum = 0;
      for (const row of prevDist) {
        const cnt = parseInt(row.count, 10);
        prevCount += cnt;
        prevSum += parseInt(row.rating, 10) * cnt;
      }
      prevAvgRating = prevCount > 0 ? parseFloat((prevSum / prevCount).toFixed(1)) : 0;
      deltaRating = parseFloat((currentAvgRating - prevAvgRating).toFixed(1));
    }

    // 2. TOTAL REVIEWS (Cumulative count)
    const totalCurrentQb = this.reviewRepository
      .createQueryBuilder('review')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (!isAll && rangeRes.to) {
      totalCurrentQb.andWhere('review.createdAt <= :to', { to: rangeRes.to });
    }
    const totalReviewsValue = await totalCurrentQb.getCount();

    let totalReviewsPrevious: number | null = null;
    let totalReviewsDeltaPct: number | null = null;

    if (!isAll && rangeRes.prevTo) {
      totalReviewsPrevious = await this.reviewRepository
        .createQueryBuilder('review')
        .where('review.businessId = :businessId', { businessId })
        .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
        .andWhere('review.createdAt <= :prevTo', { prevTo: rangeRes.prevTo })
        .getCount();

      if (totalReviewsPrevious > 0) {
        totalReviewsDeltaPct = Math.round(((totalReviewsValue - totalReviewsPrevious) / totalReviewsPrevious) * 100);
      } else {
        totalReviewsDeltaPct = totalReviewsValue > 0 ? 100 : 0;
      }
    }

    // 3. NEW REVIEWS (Count created in period)
    const newReviewsValue = currentPeriodReviewCount;
    let newReviewsPrevious: number | null = null;
    let newReviewsDeltaPct: number | null = null;

    if (!isAll && rangeRes.prevFrom && rangeRes.prevTo) {
      newReviewsPrevious = await this.reviewRepository
        .createQueryBuilder('review')
        .where('review.businessId = :businessId', { businessId })
        .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
        .andWhere('review.createdAt >= :prevFrom AND review.createdAt <= :prevTo', {
          prevFrom: rangeRes.prevFrom,
          prevTo: rangeRes.prevTo,
        })
        .getCount();

      if (newReviewsPrevious > 0) {
        newReviewsDeltaPct = Math.round(((newReviewsValue - newReviewsPrevious) / newReviewsPrevious) * 100);
      } else {
        newReviewsDeltaPct = newReviewsValue > 0 ? 100 : 0;
      }
    }

    // 4. RESPONSE RATE (% of reviews created in period that have a reply)
    const repliedInPeriodQb = this.reviewRepository
      .createQueryBuilder('review')
      .innerJoin('review.reply', 'reply')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (!isAll && rangeRes.from && rangeRes.to) {
      repliedInPeriodQb.andWhere('review.createdAt >= :from AND review.createdAt <= :to', {
        from: rangeRes.from,
        to: rangeRes.to,
      });
    }

    const repliedInPeriodCount = await repliedInPeriodQb.getCount();
    const responseRateValue = currentPeriodReviewCount > 0
      ? Math.round((repliedInPeriodCount / currentPeriodReviewCount) * 100)
      : 0;

    let responseRatePrevious: number | null = null;
    let responseRateDelta: number | null = null;

    if (!isAll && rangeRes.prevFrom && rangeRes.prevTo) {
      const prevTotalCreated = newReviewsPrevious || 0;
      const prevReplied = await this.reviewRepository
        .createQueryBuilder('review')
        .innerJoin('review.reply', 'reply')
        .where('review.businessId = :businessId', { businessId })
        .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
        .andWhere('review.createdAt >= :prevFrom AND review.createdAt <= :prevTo', {
          prevFrom: rangeRes.prevFrom,
          prevTo: rangeRes.prevTo,
        })
        .getCount();

      responseRatePrevious = prevTotalCreated > 0
        ? Math.round((prevReplied / prevTotalCreated) * 100)
        : 0;
      responseRateDelta = responseRateValue - responseRatePrevious;
    }

    // 5. REVIEW STATUS (replied, unreplied, reported based on cumulative total_reviews)
    const cumulativeRepliedQb = this.reviewRepository
      .createQueryBuilder('review')
      .innerJoin('review.reply', 'reply')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });

    if (!isAll && rangeRes.to) {
      cumulativeRepliedQb.andWhere('review.createdAt <= :to', { to: rangeRes.to });
    }
    const statusRepliedCount = await cumulativeRepliedQb.getCount();
    const statusUnrepliedCount = Math.max(0, totalReviewsValue - statusRepliedCount);

    const statusReportedQb = this.reviewRepository
      .createQueryBuilder('review')
      .where('review.businessId = :businessId', { businessId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
      .andWhere(
        `EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = review.id AND rr.status = :reportedStatus)`,
        { reportedStatus: ReviewReportStatus.PENDING },
      );

    if (!isAll && rangeRes.to) {
      statusReportedQb.andWhere('review.createdAt <= :to', { to: rangeRes.to });
    }
    const statusReportedCount = await statusReportedQb.getCount();

    return {
      range: {
        key: rangeRes.key,
        from: rangeRes.fromIso,
        to: rangeRes.toIso,
      },
      stats: {
        average_rating: {
          value: currentAvgRating,
          previous: prevAvgRating,
          delta: deltaRating,
        },
        total_reviews: {
          value: totalReviewsValue,
          previous: totalReviewsPrevious,
          delta_pct: totalReviewsDeltaPct,
        },
        new_reviews: {
          value: newReviewsValue,
          previous: newReviewsPrevious,
          delta_pct: newReviewsDeltaPct,
        },
        response_rate: {
          value: responseRateValue,
          previous: responseRatePrevious,
          delta: responseRateDelta,
        },
      },
      rating_distribution: ratingDistribution,
      review_status: {
        replied: statusRepliedCount,
        unreplied: statusUnrepliedCount,
        reported: statusReportedCount,
      },
    };
  }

  async getRatingTrend(businessId: string, rangeStr?: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const rangeRes = resolveRange(rangeStr || '30d');

    let bucket: 'day' | 'week' | 'month' = 'week';
    if (rangeRes.key === '7d') bucket = 'day';
    else if (rangeRes.key === '30d' || rangeRes.key === '3m') bucket = 'week';
    else bucket = 'month';

    const points: Array<{ start: string; average_rating: number | null; review_count: number }> = [];

    const now = rangeRes.to || new Date();
    const intervals: Array<{ start: Date; end: Date }> = [];

    if (bucket === 'day') {
      const from = rangeRes.from || new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      for (let i = 0; i < 7; i++) {
        const start = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
        intervals.push({ start, end });
      }
    } else if (bucket === 'week') {
      const weeksCount = rangeRes.key === '3m' ? 13 : 5;
      const from = rangeRes.from || new Date(now.getTime() - (weeksCount * 7 - 1) * 24 * 60 * 60 * 1000);
      for (let i = 0; i < weeksCount; i++) {
        const start = new Date(from.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
        intervals.push({ start, end });
      }
    } else {
      const monthsCount = 12;
      const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const curYear = wibNow.getUTCFullYear();
      const curMonth = wibNow.getUTCMonth();

      for (let i = monthsCount - 1; i >= 0; i--) {
        const targetMonth = (curMonth - i + 1200) % 12;
        const targetYear = curYear - Math.floor((11 - (curMonth - i + 1200) % 12) / 12);

        const start = new Date(Date.UTC(targetYear, targetMonth, 1, -7, 0, 0, 0));
        const end = new Date(Date.UTC(targetYear, targetMonth + 1, 1, -7, 0, 0, -1));
        intervals.push({ start, end });
      }
    }

    for (const interval of intervals) {
      const rawRes = await this.reviewRepository
        .createQueryBuilder('review')
        .select('COUNT(review.id)', 'count')
        .addSelect('SUM(review.rating)', 'sum')
        .where('review.businessId = :businessId', { businessId })
        .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
        .andWhere('review.createdAt >= :start AND review.createdAt <= :end', {
          start: interval.start,
          end: interval.end,
        })
        .getRawOne();

      const cnt = parseInt(rawRes?.count || '0', 10);
      const sum = parseFloat(rawRes?.sum || '0');
      const avg = cnt > 0 ? parseFloat((sum / cnt).toFixed(1)) : null;

      const wibStart = new Date(interval.start.getTime() + 7 * 60 * 60 * 1000);
      const dateStr = wibStart.toISOString().split('T')[0];

      points.push({
        start: dateStr,
        average_rating: avg,
        review_count: cnt,
      });
    }

    return {
      bucket,
      points,
    };
  }
}

