import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { User } from './users/entities/user.entity.js';
import { OtpCode } from './auth/entities/otp-code.entity.js';
import { Business } from './businesses/entities/business.entity.js';
import { BusinessMember } from './businesses/entities/business-member.entity.js';
import { UserBusinessHistory } from './businesses/entities/user-business-history.entity.js';
import { UserFavoriteBusiness } from './businesses/entities/user-favorite-business.entity.js';
import { BusinessOperatingHours } from './businesses/entities/business-operating-hours.entity.js';
import { CustomerLog } from './customer-logs/entities/customer-log.entity.js';
import { Place } from './provider/entities/place.entity.js';
import { BusinessClaim } from './business-claims/entities/business-claim.entity.js';
import { Review } from './reviews/entities/review.entity.js';
import { ReviewReply } from './reviews/entities/review-reply.entity.js';
import { ReviewHelpful } from './reviews/entities/review-helpful.entity.js';
import { ReviewReport } from './review-reports/entities/review-report.entity.js';
import { CmsContent } from './cms/entities/cms-content.entity.js';
import { ContentSeo } from './cms/entities/content-seo.entity.js';
import { ContentRevision } from './cms/entities/content-revision.entity.js';
import { CmsCategory } from './cms/entities/cms-category.entity.js';
import { CmsTag } from './cms/entities/cms-tag.entity.js';
import { CmsMedia } from './cms/entities/cms-media.entity.js';

import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { BusinessesModule } from './businesses/businesses.module.js';
import { BusinessClaimsModule } from './business-claims/business-claims.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { DataForSeoModule } from './dataforseo/dataforseo.module.js';
import { AdminManagementModule } from './admin-management/admin-management.module.js';
import { ReviewReportsModule } from './review-reports/review-reports.module.js';
import { CmsModule } from './cms/cms.module.js';
import { CustomerLogsModule } from './customer-logs/customer-logs.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST') || '43.133.133.58',
        port: parseInt(configService.get<string>('DATABASE_PORT') || '5432', 10),
        username: configService.get<string>('DATABASE_USER') || 'postgres',
        password: configService.get<string>('DATABASE_PASSWORD') || 'bismillah_transgo_emas',
        database: configService.get<string>('DATABASE_NAME') || 'katamereka_db',
        entities: [
          User,
          OtpCode,
          Business,
          BusinessMember,
          UserBusinessHistory,
          UserFavoriteBusiness,
          BusinessOperatingHours,
          CustomerLog,
          Place,
          BusinessClaim,
          Review,
          ReviewReply,
          ReviewHelpful,
          ReviewReport,
          CmsContent,
          ContentSeo,
          ContentRevision,
          CmsCategory,
          CmsTag,
          CmsMedia,
        ],
        synchronize: true,
      }),
    }),
    CustomerLogsModule,
    AuthModule,
    UsersModule,
    BusinessesModule,
    BusinessClaimsModule,
    ReviewsModule,
    DataForSeoModule,
    AdminManagementModule,
    ReviewReportsModule,
    CmsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
