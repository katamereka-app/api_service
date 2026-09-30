import { Injectable, ConflictException, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { User, UserStatus } from '../users/entities/user.entity.js';
import { BusinessMember } from '../businesses/entities/business-member.entity.js';
import { OtpCode, OtpType } from './entities/otp-code.entity.js';
import { MailService } from './mail.service.js';
import { RegisterDto, LoginDto, ChangePasswordDto, SendOtpDto, VerifyOtpDto, ResetPasswordDto } from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OtpCode)
    private readonly otpRepository: Repository<OtpCode>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async sendOtp(dto: SendOtpDto) {
    const email = dto.email.toLowerCase().trim();

    if (dto.type === OtpType.REGISTRATION) {
      const existingUser = await this.userRepository.findOne({ where: { email } });
      if (existingUser) {
        throw new ConflictException('Email sudah terdaftar. Silakan login atau gunakan email lain.');
      }
    } else if (dto.type === OtpType.FORGOT_PASSWORD) {
      const existingUser = await this.userRepository.findOne({ where: { email } });
      if (!existingUser) {
        throw new NotFoundException('Email tidak terdaftar di akun Katamereka manapun.');
      }
    }

    // Invalidate previous active OTPs for this email and type
    await this.otpRepository.update({ email, type: dto.type, isUsed: false }, { isUsed: true });

    // Generate 6 digit numeric OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    const otpEntity = this.otpRepository.create({
      email,
      code,
      type: dto.type,
      expiresAt,
      isUsed: false,
    });

    await this.otpRepository.save(otpEntity);

    // Send Email via Resend
    await this.mailService.sendOtpEmail(email, code, dto.type);

    return {
      message: `Kode OTP berhasil dikirim ke email ${email}`,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const email = dto.email.toLowerCase().trim();
    const otp = await this.otpRepository.findOne({
      where: {
        email,
        code: dto.otp,
        type: dto.type,
        isUsed: false,
      },
    });

    if (!otp) {
      throw new BadRequestException('Kode OTP tidak valid atau salah');
    }

    if (new Date() > otp.expiresAt) {
      throw new BadRequestException('Kode OTP telah kadaluarsa. Silakan minta kode OTP baru.');
    }

    return {
      message: 'Kode OTP valid',
      valid: true,
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email sudah terdaftar');
    }

    // Verify and consume OTP
    await this.validateAndMarkOtpUsed(email, dto.otp, OtpType.REGISTRATION);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = this.userRepository.create({
      name: dto.name,
      email,
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });

    await this.userRepository.save(user);

    // Fresh signup never has a business membership yet.
    const token = this.generateToken(user.id, user.email, user.role, null);

    return {
      message: 'Registrasi berhasil',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        role: user.role,
        businessRole: null,
      },
      accessToken: token,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('Email tidak terdaftar');
    }

    // Verify and consume OTP for FORGOT_PASSWORD
    await this.validateAndMarkOtpUsed(email, dto.otp, OtpType.FORGOT_PASSWORD);

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(dto.newPassword, salt);
    await this.userRepository.save(user);

    return {
      message: 'Password berhasil direset. Silakan login kembali dengan password baru Anda.',
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Email atau password salah');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Akun Anda sedang dinonaktifkan atau dibanned');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Business membership is looked up server-side and signed into the token —
    // the frontend must never be trusted to assert its own business context.
    const membership = await this.businessMemberRepository.findOne({ where: { userId: user.id } });
    const businessRole = membership?.role ?? null;

    const token = this.generateToken(user.id, user.email, user.role, businessRole);

    return {
      message: 'Login berhasil',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        role: user.role,
        businessRole,
      },
      accessToken: token,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User tidak ditemukan');
    }

    const isMatch = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Password lama salah');
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(dto.newPassword, salt);
    await this.userRepository.save(user);

    return {
      message: 'Password berhasil diperbarui',
    };
  }

  private async validateAndMarkOtpUsed(email: string, code: string, type: OtpType): Promise<void> {
    const otp = await this.otpRepository.findOne({
      where: {
        email,
        code,
        type,
        isUsed: false,
      },
    });

    if (!otp) {
      throw new BadRequestException('Kode OTP tidak valid atau telah digunakan');
    }

    if (new Date() > otp.expiresAt) {
      throw new BadRequestException('Kode OTP telah kadaluarsa. Silakan minta kode OTP baru.');
    }

    otp.isUsed = true;
    await this.otpRepository.save(otp);
  }

  private generateToken(
    userId: string,
    email: string,
    role: string,
    businessRole: string | null,
  ): string {
    return this.jwtService.sign({ sub: userId, email, role, businessRole });
  }
}
