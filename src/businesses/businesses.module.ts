import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from './entities/business.entity.js';
import { BusinessMember } from './entities/business-member.entity.js';
import { UserBusinessHistory } from './entities/user-business-history.entity.js';
import { UserFavoriteBusiness } from './entities/user-favorite-business.entity.js';
import { BusinessOperatingHours } from './entities/business-operating-hours.entity.js';
import { User } from '../users/entities/user.entity.js';
import { BusinessesService } from './businesses.service.js';
import { OperatingHoursService } from './operating-hours.service.js';
import { BusinessesController } from './businesses.controller.js';
import { ProviderModule } from '../provider/provider.module.js';
import { StorageService } from './storage/storage.service.js';
import { S3StorageService } from './storage/s3-storage.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      BusinessMember,
      UserBusinessHistory,
      UserFavoriteBusiness,
      BusinessOperatingHours,
      User,
    ]),
    ProviderModule,
  ],
  controllers: [BusinessesController],
  providers: [
    BusinessesService,
    OperatingHoursService,
    {
      provide: StorageService,
      useClass: S3StorageService,
    },
  ],
  exports: [BusinessesService, OperatingHoursService, TypeOrmModule],
})
export class BusinessesModule {}
