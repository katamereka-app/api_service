import { Controller, Get, Param, Query } from '@nestjs/common';
import { CmsService } from './cms.service.js';
import { GetContentsQueryDto } from './dto/get-contents-query.dto.js';

@Controller('cms')
export class PublicCmsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get('contents')
  async findAllPublic(@Query() query: GetContentsQueryDto) {
    return this.cmsService.findAllPublic(query);
  }

  @Get('contents/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.cmsService.findPublicBySlug(slug);
  }

  @Get('categories')
  async getCategories() {
    return this.cmsService.getCategories();
  }

  @Get('tags')
  async getTags() {
    return this.cmsService.getTags();
  }
}
