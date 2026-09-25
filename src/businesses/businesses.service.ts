import { Injectable, NotFoundException, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business, BusinessStatus } from './entities/business.entity.js';
import { BusinessMember, BusinessRole } from './entities/business-member.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateBusinessDto, UpdateBusinessDto, AddBusinessMemberDto, SyncGoogleBusinessDto } from './dto/business.dto.js';
import { SyncBusinessesDto } from './dto/sync-businesses.dto.js';
import { GetBusinessesQueryDto } from './dto/get-businesses-query.dto.js';
import { ProviderService } from '../provider/provider.service.js';
import { NormalizedGeoapifyBusiness } from '../provider/interfaces/normalized-geoapify-business.interface.js';

@Injectable()
export class BusinessesService {
  private readonly logger = new Logger(BusinessesService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly memberRepository: Repository<BusinessMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly providerService: ProviderService,
  ) {}

  async syncBusinesses(dto: SyncBusinessesDto) {
    this.logger.log(`Memulai Sync Business dari Provider dengan Keyword: "${dto.keyword}", Location: "${dto.location}"`);

    // 1. Ambil data dari provider eksternal (Geoapify)
    const normalizedItems = await this.providerService.searchBusinesses(dto.keyword, dto.location);
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
      // UPDATE POLICY: Hanya perbarui data eksternal, TIDAK MENIMPA id internal atau slug custom
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
      if (item.externalRating !== null) existing.externalRating = item.externalRating;
      if (item.externalReviewsCount !== null) existing.externalReviewsCount = item.externalReviewsCount;
      existing.externalSyncedAt = item.externalSyncedAt;

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

    if (query.search) {
      queryBuilder.andWhere('(b.name ILIKE :search OR b.address ILIKE :search)', {
        search: `%${query.search}%`,
      });
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

  async findOne(id: string, currentUserId?: string) {
    const business = await this.businessRepository.findOne({ where: { id } });
    if (!business) {
      throw new NotFoundException('Bisnis tidak ditemukan');
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
    const business = await this.businessRepository.findOne({ where: { slug } });
    if (!business) {
      throw new NotFoundException('Bisnis dengan slug ini tidak ditemukan');
    }

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
}
