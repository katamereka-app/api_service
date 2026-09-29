import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from './entities/business.entity.js';
import { BusinessMember } from './entities/business-member.entity.js';
import { UserBusinessHistory } from './entities/user-business-history.entity.js';
import { User } from '../users/entities/user.entity.js';
import { BusinessesService } from './businesses.service.js';
import { BusinessesController } from './businesses.controller.js';
import { ProviderModule } from '../provider/provider.module.js';
import { StorageService } from './storage/storage.service.js';
import { LocalStorageService } from './storage/local-storage.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Business, BusinessMember, UserBusinessHistory, User]), ProviderModule],
  controllers: [BusinessesController],
  providers: [
    BusinessesService,
    {
      provide: StorageService,
      useClass: LocalStorageService,
    },
  ],
  exports: [BusinessesService, TypeOrmModule],
})
export class BusinessesModule {}
