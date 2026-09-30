import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { User, UserStatus, PlatformRole } from './entities/user.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { UserFavoriteBusiness } from '../businesses/entities/user-favorite-business.entity.js';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(UserFavoriteBusiness)
    private readonly favoriteRepository: Repository<UserFavoriteBusiness>,
  ) {}

  async findAll() {
    const users = await this.userRepository.find({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { createdAt: 'DESC' },
    });
    return {
      message: 'Berhasil mengambil daftar user/customer/admin',
      data: users,
    };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }
    return {
      message: 'Berhasil mengambil detail user',
      data: user,
    };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = this.userRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: dto.role || PlatformRole.USER,
      status: dto.status || UserStatus.ACTIVE,
    });

    await this.userRepository.save(user);

    return {
      message: 'User berhasil ditambahkan',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    if (dto.name) user.name = dto.name;
    if (dto.email) user.email = dto.email;
    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;

    await this.userRepository.save(user);

    return {
      message: 'Data user berhasil diperbarui',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  async remove(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    await this.userRepository.remove(user);
    return {
      message: 'User berhasil dihapus',
    };
  }

  async getProfileSummary(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const totalReviews = await this.reviewRepository.count({ where: { userId } });
    const totalSavedBusinesses = await this.favoriteRepository.count({ where: { userId } });

    return {
      success: true,
      message: 'Berhasil mengambil ringkasan profil customer',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          isVerified: !!user.emailVerifiedAt,
          createdAt: user.createdAt,
        },
        stats: {
          totalReviews,
          totalHelpfulVotes: 0,
          totalSavedBusinesses,
        },
      },
    };
  }
}

