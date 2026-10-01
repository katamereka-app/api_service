import { Injectable, NotFoundException, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business, BusinessStatus } from './entities/business.entity.js';
import { BusinessMember, BusinessRole } from './entities/business-member.entity.js';
import { UserBusinessHistory } from './entities/user-business-history.entity.js';
import { UserFavoriteBusiness } from './entities/user-favorite-business.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateBusinessDto, UpdateBusinessDto, AddBusinessMemberDto, SyncGoogleBusinessDto } from './dto/business.dto.js';
import { SyncBusinessesDto } from './dto/sync-businesses.dto.js';
import { GetBusinessesQueryDto } from './dto/get-businesses-query.dto.js';
import { ProviderService } from '../provider/provider.service.js';
import { NormalizedGeoapifyBusiness } from '../provider/interfaces/normalized-geoapify-business.interface.js';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto.js';
import { calculateProfileCompletion } from './helpers/profile-completion.helper.js';
import { StorageService } from './storage/storage.service.js';
import { CustomerLogsService } from '../customer-logs/customer-logs.service.js';
import { ActionType } from '../customer-logs/entities/customer-log.entity.js';

@Injectable()
export class BusinessesService {
  private readonly logger = new Logger(BusinessesService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly memberRepository: Repository<BusinessMember>,
    @InjectRepository(UserBusinessHistory)
    private readonly historyRepository: Repository<UserBusinessHistory>,
    @InjectRepository(UserFavoriteBusiness)
    private readonly favoriteRepository: Repository<UserFavoriteBusiness>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly providerService: ProviderService,
    private readonly storageService: StorageService,
    private readonly customerLogsService: CustomerLogsService,
  ) {}

  /**
   * Notifies Google (via its documented sitemap ping endpoint) that
   * sitemap.xml has fresh content, instead of waiting for Googlebot's own
   * crawl schedule to pick it up. Fire-and-forget on purpose — a slow/failed
   * ping must never delay or fail the business write that triggered it, and
   * there's nothing actionable to do with the result besides log it.
   *
   * Not the Google Indexing API: that one is restricted by Google's ToS to
   * JobPosting/BroadcastEvent content and would risk a penalty here. The
   * sitemap ping is the documented, general-purpose mechanism.
   */
  private pingSitemapUpdate(): void {
    const siteUrl = process.env.CONSUMER_SITE_URL || 'https://katamereka.id';
    const sitemapUrl = `${siteUrl}/sitemap.xml`;
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;

    fetch(pingUrl)
      .then((res) => {
        this.logger.log(`Ping sitemap ke Google: ${res.status} (${sitemapUrl})`);
      })
      .catch((err) => {
        this.logger.warn(`Gagal ping sitemap ke Google: ${err}`);
      });
  }

  async syncBusinesses(dto: SyncBusinessesDto) {
    this.logger.log(`Memulai Sync Business dari Provider dengan Keyword: "${dto.keyword}", Location: "${dto.location}"`);

    const limit = dto.limit || 100;
    const normalizedItems = await this.providerService.searchBusinesses(dto.keyword, dto.location, limit);
    const fetched = normalizedItems.length;

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    // 2. Loop & UPSERT ke PostgreSQL
    for (const item of normalizedItems) {
      try {
        const result = await this.upsertBusiness(item);
        if (result === 'inserted') {
          inserted++;
        } else if (result === 'updated') {
          updated++;
        }
      } catch (err) {
        this.logger.error(`Gagal upsert bisnis "${item.name}":`, err);
        failed++;
      }
    }

    // Once for the whole batch, not per item — a sync can touch up to
    // `limit` businesses and the sitemap only needs one fresh-content signal.
    if (inserted > 0 || updated > 0) {
      this.pingSitemapUpdate();
    }

    return {
      success: true,
      fetched,
      inserted,
      updated,
      failed,
    };
  }

  async upsertBusiness(item: NormalizedGeoapifyBusiness): Promise<'inserted' | 'updated'> {
    let existing: Business | null = null;

    // Prioritas 1: Cari berdasarkan external_source & external_id (Unique Constraint)
    if (item.externalId) {
      existing = await this.businessRepository.findOne({
        where: { externalSource: item.externalSource, externalId: item.externalId },
      });
    }

    // Prioritas 2 (Fallback): Cari berdasarkan slug
    if (!existing && item.slug) {
      existing = await this.businessRepository.findOne({ where: { slug: item.slug } });
    }

    if (existing) {
      // SOURCE OF TRUTH POLICY: Jika bisnis sudah diklaim, external sync TIDAK BOLEH menimpa data yang dikelola owner!
      if (existing.isClaimed) {
        if (item.externalId) existing.externalId = item.externalId;
        if (item.externalRating !== null) existing.externalRating = item.externalRating;
        if (item.externalReviewsCount !== null) existing.externalReviewsCount = item.externalReviewsCount;
        existing.externalSyncedAt = item.externalSyncedAt;
      } else {
        existing.name = item.name;
        if (item.externalId) existing.externalId = item.externalId;
        if (item.address) existing.address = item.address;
        if (item.city) existing.city = item.city;
        if (item.province) existing.province = item.province;
        if (item.country) existing.country = item.country;
        if (item.postalCode) existing.postalCode = item.postalCode;
        if (item.latitude !== null) existing.latitude = item.latitude;
        if (item.longitude !== null) existing.longitude = item.longitude;
        if (item.phone) existing.phone = item.phone;
        if (item.email) existing.email = item.email;
        if (item.website) existing.website = item.website;
        if (item.category) existing.category = item.category;
        if (item.categories) existing.categories = item.categories;
        if (item.openingHours) existing.openingHours = item.openingHours;
        if (item.facilities) existing.facilities = item.facilities;
        if (item.catering) existing.catering = item.catering;
        if (item.externalMetadata) existing.externalMetadata = item.externalMetadata;
        if (item.externalRating !== null) existing.externalRating = item.externalRating;
        if (item.externalReviewsCount !== null) existing.externalReviewsCount = item.externalReviewsCount;
        existing.externalSyncedAt = item.externalSyncedAt;
      }

      await this.businessRepository.save(existing);
      return 'updated';
    } else {
      // INSERT POLICY: Buat record bisnis baru dengan slug unik
      let uniqueSlug = item.slug;
      const slugCount = await this.businessRepository.count({ where: { slug: item.slug } });
      if (slugCount > 0) {
        uniqueSlug = `${item.slug}-${Date.now().toString().slice(-4)}`;
      }

      const newBusiness = this.businessRepository.create({
        name: item.name,
        slug: uniqueSlug,
        externalSource: item.externalSource,
        externalId: item.externalId,
        address: item.address,
        city: item.city,
        province: item.province,
        country: item.country,
        postalCode: item.postalCode,
        latitude: item.latitude,
        longitude: item.longitude,
        phone: item.phone,
        email: item.email,
        website: item.website,
        category: item.category,
        categories: item.categories,
        openingHours: item.openingHours,
        facilities: item.facilities,
        catering: item.catering,
        externalMetadata: item.externalMetadata,
        externalRating: item.externalRating,
        externalReviewsCount: item.externalReviewsCount,
        status: BusinessStatus.ACTIVE,
        externalSyncedAt: item.externalSyncedAt,
      });

      await this.businessRepository.save(newBusiness);
      return 'inserted';
    }
  }

  async findAll(query: GetBusinessesQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const queryBuilder = this.businessRepository.createQueryBuilder('b');

    // Public listing/search — only businesses visitors should actually see.
    // (Previously unfiltered: PENDING/SUSPENDED/INACTIVE rows leaked into
    // public search results and category/city pages built on top of it.)
    queryBuilder.andWhere('b.status IN (:...publicStatuses)', {
      publicStatuses: [BusinessStatus.ACTIVE, BusinessStatus.CLAIMED],
    });

    if (query.search) {
      queryBuilder.andWhere(
        '(b.name ILIKE :search OR b.address ILIKE :search OR b.category ILIKE :search OR b.slug ILIKE :search OR b.categories::text ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.city) {
      queryBuilder.andWhere('b.city ILIKE :city', { city: `%${query.city}%` });
    }

    if (query.province) {
      queryBuilder.andWhere('b.province ILIKE :province', { province: `%${query.province}%` });
    }

    if (query.category) {
      queryBuilder.andWhere('b.category ILIKE :category', { category: `%${query.category}%` });
    }

    queryBuilder.orderBy('b.createdAt', 'DESC');
    queryBuilder.skip(skip).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      data: items.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        address: b.address,
        city: b.city,
        province: b.province,
        category: b.category,
        rating: b.externalRating,
        reviews_count: b.externalReviewsCount,
        status: b.status,
        updated_at: b.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }

  /**
   * Lightweight, unpaginated feed of every public business slug + last
   * update time — built for the FE sitemap generator so it doesn't have to
   * page through the full `/businesses` listing (with all its unrelated
   * fields) just to build <loc>/<lastmod> entries.
   */
  async getSitemapBusinesses() {
    const businesses = await this.businessRepository
      .createQueryBuilder('b')
      .select(['b.slug', 'b.updatedAt'])
      .where('b.status IN (:...publicStatuses)', {
        publicStatuses: [BusinessStatus.ACTIVE, BusinessStatus.CLAIMED],
      })
      .andWhere('b.slug IS NOT NULL')
      .orderBy('b.updatedAt', 'DESC')
      .getMany();

    return {
      success: true,
      data: businesses.map((b) => ({
        slug: b.slug,
        updated_at: b.updatedAt,
      })),
    };
  }

  /**
   * Distinct `category` values actually in use by public businesses, with
   * counts — lets the FE build /kategori/{slug} pages (and the sitemap)
   * from real data instead of a hardcoded design-time list. Note: `category`
   * stores the raw Geoapify taxonomy leaf (e.g. "catering.restaurant"), not
   * an Indonesian display label — the FE is responsible for any display
   * mapping/slugging.
   */
  async getCategoryFacets() {
    const rows = await this.businessRepository
      .createQueryBuilder('b')
      .select('b.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('b.status IN (:...publicStatuses)', {
        publicStatuses: [BusinessStatus.ACTIVE, BusinessStatus.CLAIMED],
      })
      .andWhere('b.category IS NOT NULL')
      .andWhere("b.category != ''")
      .groupBy('b.category')
      .orderBy('count', 'DESC')
      .getRawMany<{ category: string; count: string }>();

    return {
      success: true,
      data: rows.map((r) => ({ category: r.category, count: Number(r.count) })),
    };
  }

  /**
   * Distinct `city` values actually in use by public businesses, with
   * counts — powers /lokasi/{slug} pages the same way getCategoryFacets
   * powers /kategori/{slug}.
   */
  async getCityFacets() {
    const rows = await this.businessRepository
      .createQueryBuilder('b')
      .select('b.city', 'city')
      .addSelect('COUNT(*)', 'count')
      .where('b.status IN (:...publicStatuses)', {
        publicStatuses: [BusinessStatus.ACTIVE, BusinessStatus.CLAIMED],
      })
      .andWhere('b.city IS NOT NULL')
      .andWhere("b.city != ''")
      .groupBy('b.city')
      .orderBy('count', 'DESC')
      .getRawMany<{ city: string; count: string }>();

    return {
      success: true,
      data: rows.map((r) => ({ city: r.city, count: Number(r.count) })),
    };
  }

  async getPopularBusinesses(limit: number = 10) {
    const take = limit > 50 ? 50 : limit;

    const businesses = await this.businessRepository
      .createQueryBuilder('b')
      .where('b.status = :status', { status: BusinessStatus.ACTIVE })
      .orderBy('COALESCE(b.averageRating, b.externalRating, 0)', 'DESC')
      .addOrderBy('COALESCE(b.reviewCount, b.externalReviewsCount, 0)', 'DESC')
      .take(take)
      .getMany();

    return {
      success: true,
      message: 'Berhasil mengambil daftar bisnis populer',
      data: businesses.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        address: b.address,
        city: b.city,
        province: b.province,
        category: b.category,
        rating: b.averageRating ? Number(b.averageRating) : (b.externalRating ? Number(b.externalRating) : 0),
        reviews_count: (b.reviewCount && b.reviewCount > 0) ? b.reviewCount : (b.externalReviewsCount ?? 0),
        logo_url: b.logoUrl,
        cover_url: b.coverUrl,
        is_claimed: b.isClaimed,
        status: b.status,
      })),
    };
  }

  async recordBusinessView(userId: string, businessId: string) {
    if (!userId || !businessId) return;

    try {
      let history = await this.historyRepository.findOne({ where: { userId, businessId } });
      if (history) {
        history.viewedAt = new Date();
        await this.historyRepository.save(history);
      } else {
        history = this.historyRepository.create({
          userId,
          businessId,
          viewedAt: new Date(),
        });
        await this.historyRepository.save(history);
      }

      // Max 30 items per user constraint
      const userHistories = await this.historyRepository.find({
        where: { userId },
        order: { viewedAt: 'DESC' },
      });

      if (userHistories.length > 30) {
        const overflow = userHistories.slice(30);
        await this.historyRepository.remove(overflow);
      }
    } catch (err) {
      this.logger.error(`Gagal mencatat view history user ${userId} untuk bisnis ${businessId}:`, err);
    }
  }

  async getRecentlyViewed(userId: string, limit: number = 30) {
    const take = limit > 30 ? 30 : (limit < 1 ? 10 : limit);

    const histories = await this.historyRepository.find({
      where: { userId },
      relations: { business: true },
      order: { viewedAt: 'DESC' },
      take,
    });

    return {
      success: true,
      message: 'Berhasil mengambil daftar bisnis terakhir dilihat',
      data: histories
        .filter((h) => h.business)
        .map((h) => ({
          id: h.business.id,
          name: h.business.name,
          slug: h.business.slug,
          address: h.business.address,
          city: h.business.city,
          province: h.business.province,
          category: h.business.category,
          rating: h.business.averageRating ? Number(h.business.averageRating) : (h.business.externalRating ? Number(h.business.externalRating) : 0),
          reviews_count: (h.business.reviewCount && h.business.reviewCount > 0) ? h.business.reviewCount : (h.business.externalReviewsCount ?? 0),
          logo_url: h.business.logoUrl,
          cover_url: h.business.coverUrl,
          is_claimed: h.business.isClaimed,
          status: h.business.status,
          viewed_at: h.viewedAt,
        })),
    };
  }

  async getMyBusinesses(userId: string) {
    const memberships = await this.memberRepository.find({
      where: { userId },
      relations: { business: true },
      order: { createdAt: 'DESC' },
    });

    return memberships.map((m) => ({
      id: m.business?.id,
      name: m.business?.name,
      slug: m.business?.slug,
      role: m.role,
      is_claimed: m.business?.isClaimed || false,
    }));
  }

  private async ensureBusinessPhotos(business: Business): Promise<Business> {
    if ((business.photos && business.photos.length > 0) && business.coverUrl) {
      return business;
    }

    try {
      const cleanId = (business.externalId || business.id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      const filename = `place_${cleanId}.jpg`;
      const existingS3Url = await this.storageService.getExistingFileUrl(filename, 'places');

      if (existingS3Url) {
        business.coverUrl = business.coverUrl || existingS3Url;
        business.logoUrl = business.logoUrl || existingS3Url;
        business.photos = business.photos && business.photos.length > 0 ? business.photos : [existingS3Url];
        return await this.businessRepository.save(business);
      }
    } catch (err) {
      this.logger.error(`Gagal auto-sync photo S3 untuk bisnis ${business.id}:`, err);
    }

    return business;
  }

  async findOne(id: string, currentUserId?: string) {
    let business = await this.businessRepository.findOne({ where: { id } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    business = await this.ensureBusinessPhotos(business);

    if (currentUserId) {
      this.recordBusinessView(currentUserId, id).catch(() => {});
    }

    const members = await this.memberRepository.find({
      where: { businessId: id },
      relations: { user: true },
    });

    const hasOwner = members.some((m) => m.role === BusinessRole.OWNER);
    const isClaimed = business.isClaimed || hasOwner;
    const claimAvailable = !isClaimed;

    let myRole: string | null = null;
    if (currentUserId) {
      const myMembership = members.find((m) => m.userId === currentUserId);
      if (myMembership) {
        myRole = myMembership.role;
      }
    }

    return {
      message: 'Berhasil mengambil detail bisnis dari PostgreSQL',
      data: {
        ...business,
        is_claimed: isClaimed,
        claim_available: claimAvailable,
        ...(myRole ? { my_role: myRole } : {}),
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user?.name,
          email: m.user?.email,
          role: m.role,
          createdAt: m.createdAt,
        })),
      },
    };
  }

  async findBySlug(slug: string, currentUserId?: string) {
    let business = await this.businessRepository.findOne({ where: { slug } });
    if (!business) {
      throw new NotFoundException('Bisnis dengan slug ini tidak ditemukan');
    }

    business = await this.ensureBusinessPhotos(business);

    const members = await this.memberRepository.find({
      where: { businessId: business.id },
      relations: { user: true },
    });

    const hasOwner = members.some((m) => m.role === BusinessRole.OWNER);
    const isClaimed = business.isClaimed || hasOwner;
    const claimAvailable = !isClaimed;

    let myRole: string | null = null;
    if (currentUserId) {
      const myMembership = members.find((m) => m.userId === currentUserId);
      if (myMembership) {
        myRole = myMembership.role;
      }
    }

    return {
      message: 'Berhasil mengambil detail bisnis berdasarkan slug dari PostgreSQL',
      data: {
        ...business,
        is_claimed: isClaimed,
        claim_available: claimAvailable,
        ...(myRole ? { my_role: myRole } : {}),
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user?.name,
          email: m.user?.email,
          role: m.role,
          createdAt: m.createdAt,
        })),
      },
    };
  }

  async create(ownerUserId: string, dto: CreateBusinessDto) {
    const existingSlug = await this.businessRepository.findOne({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new ConflictException('Slug bisnis sudah digunakan');
    }

    const business = this.businessRepository.create({
      name: dto.name,
      slug: dto.slug,
      externalId: dto.googlePlaceId || null,
      status: dto.status || BusinessStatus.ACTIVE,
    });

    await this.businessRepository.save(business);

    const member = this.memberRepository.create({
      businessId: business.id,
      userId: ownerUserId,
      role: BusinessRole.OWNER,
    });

    await this.memberRepository.save(member);
    this.pingSitemapUpdate();

    return {
      message: 'Bisnis berhasil dibuat',
      data: business,
      memberInfo: member,
    };
  }

  async update(id: string, dto: UpdateBusinessDto) {
    const business = await this.businessRepository.findOne({ where: { id } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (dto.name) business.name = dto.name;
    if (dto.slug) business.slug = dto.slug;
    if (dto.googlePlaceId !== undefined) business.externalId = dto.googlePlaceId;
    if (dto.status) business.status = dto.status;

    await this.businessRepository.save(business);
    this.pingSitemapUpdate();

    return {
      message: 'Data bisnis berhasil diperbarui',
      data: business,
    };
  }

  async addMember(businessId: string, dto: AddBusinessMemberDto) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const existingMember = await this.memberRepository.findOne({
      where: { businessId, userId: dto.userId },
    });
    if (existingMember) {
      throw new ConflictException('User sudah menjadi anggota di bisnis ini');
    }

    const member = this.memberRepository.create({
      businessId,
      userId: dto.userId,
      role: dto.role || BusinessRole.MEMBER,
    });

    await this.memberRepository.save(member);

    return {
      message: 'Anggota berhasil ditambahkan ke bisnis',
      data: member,
    };
  }

  async getManagedProfile(businessId: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const completion = calculateProfileCompletion(business);

    return {
      success: true,
      message: 'Berhasil mengambil profil manajemen bisnis',
      data: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        description: business.description,
        short_description: business.shortDescription,
        phone: business.phone,
        email: business.email,
        website: business.website,
        address: business.address,
        city: business.city,
        province: business.province,
        postal_code: business.postalCode,
        category: business.category,
        categories: business.categories || [],
        logo_url: business.logoUrl,
        cover_url: business.coverUrl,
        photos: business.photos || [],
        opening_hours: business.openingHours || {},
        facilities: business.facilities || {},
        social_media: business.socialMedia || {},
        latitude: business.latitude,
        longitude: business.longitude,
        profile_completion: completion.profile_completion,
        profile_completed: completion.profile_completed,
      },
    };
  }

  async updateProfile(businessId: string, userId: string, dto: UpdateBusinessProfileDto) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (dto.name !== undefined) business.name = dto.name;
    if (dto.description !== undefined) business.description = dto.description;
    if (dto.short_description !== undefined) business.shortDescription = dto.short_description;
    if (dto.photos !== undefined) business.photos = dto.photos;
    if (dto.phone !== undefined) business.phone = dto.phone;
    if (dto.email !== undefined) business.email = dto.email;
    if (dto.website !== undefined) business.website = dto.website;
    if (dto.address !== undefined) business.address = dto.address;
    if (dto.city !== undefined) business.city = dto.city;
    if (dto.province !== undefined) business.province = dto.province;
    if (dto.postal_code !== undefined) business.postalCode = dto.postal_code;
    if (dto.category !== undefined) business.category = dto.category;
    if (dto.opening_hours !== undefined) business.openingHours = dto.opening_hours;
    if (dto.social_media !== undefined) business.socialMedia = dto.social_media;

    business.updatedBy = userId;

    const completion = calculateProfileCompletion(business);
    if (completion.profile_completed && !business.profileCompletedAt) {
      business.profileCompletedAt = new Date();
    }

    await this.businessRepository.save(business);
    this.pingSitemapUpdate();

    return {
      success: true,
      message: 'Profil bisnis berhasil diperbarui',
      data: {
        id: business.id,
        name: business.name,
        description: business.description,
        short_description: business.shortDescription,
        phone: business.phone,
        email: business.email,
        website: business.website,
        address: business.address,
        city: business.city,
        province: business.province,
        postal_code: business.postalCode,
        category: business.category,
        logo_url: business.logoUrl,
        cover_url: business.coverUrl,
        photos: business.photos || [],
        opening_hours: business.openingHours || {},
        facilities: business.facilities || {},
        social_media: business.socialMedia || {},
        profile_completion: completion.profile_completion,
        profile_completed: completion.profile_completed,
      },
    };
  }

  async uploadLogo(businessId: string, userId: string, file: Express.Multer.File) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (business.logoUrl) {
      await this.storageService.deleteFile(business.logoUrl);
    }

    const fileUrl = await this.storageService.uploadFile(file, 'logos');
    business.logoUrl = fileUrl;
    business.updatedBy = userId;

    const completion = calculateProfileCompletion(business);
    if (completion.profile_completed && !business.profileCompletedAt) {
      business.profileCompletedAt = new Date();
    }

    await this.businessRepository.save(business);

    return {
      success: true,
      message: 'Logo bisnis berhasil diunggah',
      data: {
        logo_url: fileUrl,
        profile_completion: completion.profile_completion,
        profile_completed: completion.profile_completed,
      },
    };
  }

  async uploadCover(businessId: string, userId: string, file: Express.Multer.File) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (business.coverUrl) {
      await this.storageService.deleteFile(business.coverUrl);
    }

    const fileUrl = await this.storageService.uploadFile(file, 'covers');
    business.coverUrl = fileUrl;
    business.updatedBy = userId;

    await this.businessRepository.save(business);

    return {
      success: true,
      message: 'Foto cover bisnis berhasil diunggah',
      data: {
        cover_url: fileUrl,
      },
    };
  }

  async deleteLogo(businessId: string, userId: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (business.logoUrl) {
      await this.storageService.deleteFile(business.logoUrl);
      business.logoUrl = null;
      business.updatedBy = userId;
      await this.businessRepository.save(business);
    }

    return {
      success: true,
      message: 'Logo bisnis berhasil dihapus',
    };
  }

  async deleteCover(businessId: string, userId: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    if (business.coverUrl) {
      await this.storageService.deleteFile(business.coverUrl);
      business.coverUrl = null;
      business.updatedBy = userId;
      await this.businessRepository.save(business);
    }

    return {
      success: true,
      message: 'Foto cover bisnis berhasil dihapus',
    };
  }

  /**
   * Backs GET /businesses/slug/:slug and /businesses/public-profile/:slug —
   * i.e. the business profile page's server-side metadata/JSON-LD fetch AND
   * the page's own client-side data fetch. Used to return only
   * average_rating/review_count and left out latitude/longitude/status/
   * categories/postal_code/short_description/photos entirely, which meant:
   * - the FE's `rating`/`reviews_count`/`externalRating`/
   *   `externalReviewsCount` fields (and this SEO fix's review-count-based
   *   meta description, and the JSON-LD aggregateRating/geo blocks) always
   *   read undefined and silently fell back to 0/blank, regardless of the
   *   real DB values.
   * The field set below matches ApiBusinessDetail on the FE (katamereka-web
   * lib/api-client.ts) field-for-field.
   */
  async getPublicProfile(slug: string) {
    const business = await this.businessRepository.findOne({ where: { slug } });
    if (!business) {
      throw new NotFoundException('Profil bisnis tidak ditemukan');
    }

    return {
      success: true,
      message: 'Berhasil mengambil profil publik bisnis',
      data: {
        id: business.id,
        slug: business.slug,
        name: business.name,
        description: business.description,
        short_description: business.shortDescription,
        logo_url: business.logoUrl,
        cover_url: business.coverUrl,
        photos: business.photos || [],
        category: business.category,
        categories: business.categories || [],
        address: business.address,
        city: business.city,
        province: business.province,
        country: business.country,
        postal_code: business.postalCode,
        latitude: business.latitude,
        longitude: business.longitude,
        phone: business.phone,
        email: business.email,
        website: business.website,
        opening_hours: business.openingHours || {},
        facilities: business.facilities || {},
        social_media: business.socialMedia || {},
        status: business.status,
        rating: business.averageRating ? parseFloat(business.averageRating.toString()) : null,
        reviews_count: business.reviewCount || 0,
        externalRating: business.externalRating,
        externalReviewsCount: business.externalReviewsCount,
        // Kept for any existing caller still reading the old field names.
        average_rating: business.averageRating ? parseFloat(business.averageRating.toString()) : 0,
        review_count: business.reviewCount || 0,
      },
    };
  }

  async toggleFavorite(userId: string, businessId: string) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
    }

    const existingFav = await this.favoriteRepository.findOne({
      where: { userId, businessId },
    });

    if (existingFav) {
      await this.favoriteRepository.remove(existingFav);

      // Log ke CustomerLogs
      await this.customerLogsService.logAction(userId, ActionType.DELETE, {
        action: 'UNFAVORITE_BUSINESS',
        businessId: business.id,
        businessName: business.name,
      });

      return {
        success: true,
        message: 'Bisnis berhasil dihapus dari daftar favorit',
        isFavorite: false,
      };
    } else {
      const newFav = this.favoriteRepository.create({
        userId,
        businessId,
      });
      await this.favoriteRepository.save(newFav);

      // Log ke CustomerLogs
      await this.customerLogsService.logAction(userId, ActionType.CREATE, {
        action: 'FAVORITE_BUSINESS',
        businessId: business.id,
        businessName: business.name,
      });

      return {
        success: true,
        message: 'Bisnis berhasil ditambahkan ke daftar favorit',
        isFavorite: true,
      };
    }
  }

  async getFavorites(userId: string) {
    const favorites = await this.favoriteRepository.find({
      where: { userId },
      relations: { business: true },
      order: { createdAt: 'DESC' },
    });

    const data = favorites.map((fav) => ({
      favoriteId: fav.id,
      favoritedAt: fav.createdAt,
      business: {
        id: fav.business.id,
        name: fav.business.name,
        slug: fav.business.slug,
        category: fav.business.category,
        address: fav.business.address,
        city: fav.business.city,
        province: fav.business.province,
        country: fav.business.country,
        externalRating: fav.business.externalRating,
        externalReviewsCount: fav.business.externalReviewsCount,
        averageRating: fav.business.averageRating,
        reviewCount: fav.business.reviewCount,
        logoUrl: fav.business.logoUrl,
        coverUrl: fav.business.coverUrl,
      },
    }));

    return {
      success: true,
      message: 'Berhasil mengambil daftar bisnis favorit',
      data,
    };
  }
}

