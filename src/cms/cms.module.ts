import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsContent } from './entities/cms-content.entity.js';
import { ContentSeo } from './entities/content-seo.entity.js';
import { ContentRevision } from './entities/content-revision.entity.js';
import { CmsCategory } from './entities/cms-category.entity.js';
import { CmsTag } from './entities/cms-tag.entity.js';
import { CmsMedia } from './entities/cms-media.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CmsService } from './cms.service.js';
import { AdminCmsController } from './admin-cms.controller.js';
import { PublicCmsController } from './public-cms.controller.js';
import { StorageService } from '../businesses/storage/storage.service.js';
import { LocalStorageService } from '../businesses/storage/local-storage.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CmsContent,
      ContentSeo,
      ContentRevision,
      CmsCategory,
      CmsTag,
      CmsMedia,
      User,
    ]),
  ],
  controllers: [AdminCmsController, PublicCmsController],
  providers: [
    CmsService,
    {
      provide: StorageService,
      useClass: LocalStorageService,
    },
  ],
  exports: [CmsService, TypeOrmModule],
})
export class CmsModule {}
