import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { User } from '../users/entities/user.entity.js';
import { BusinessMember } from '../businesses/entities/business-member.entity.js';
import { OtpCode } from './entities/otp-code.entity.js';
import { AuthService } from './auth.service.js';
import { MailService } from './mail.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { getJwtSecret } from './jwt-secret.util.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OtpCode, BusinessMember]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: getJwtSecret(configService),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MailService, JwtStrategy],
  exports: [AuthService, MailService],
})
export class AuthModule {}
