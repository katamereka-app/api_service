import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place } from './entities/place.entity.js';
import { Business } from '../businesses/entities/business.entity.js';
import { ProviderService } from './provider.service.js';
import { PlacesService } from './places.service.js';
import { PlacesController } from './places.controller.js';

import { BusinessPlacesService } from './business-places.service.js';
import { BusinessPlacesController } from './business-places.controller.js';
import { StorageService } from '../businesses/storage/storage.service.js';
import { S3StorageService } from '../businesses/storage/s3-storage.service.js';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Place, Business])],
  controllers: [PlacesController, BusinessPlacesController],
  providers: [
    ProviderService,
    PlacesService,
    BusinessPlacesService,
    {
      provide: StorageService,
      useClass: S3StorageService,
    },
  ],
  exports: [ProviderService, PlacesService, BusinessPlacesService, TypeOrmModule],
})
export class ProviderModule {}
