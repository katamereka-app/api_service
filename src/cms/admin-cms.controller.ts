import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import 'multer';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlatformRoleGuard, PlatformRoles } from '../business-claims/guards/platform-role.guard.js';
import { PlatformRole } from '../users/entities/user.entity.js';
import { CmsService } from './cms.service.js';
import { CreateContentDto } from './dto/create-content.dto.js';
import { UpdateContentDto } from './dto/update-content.dto.js';
import { GetContentsQueryDto } from './dto/get-contents-query.dto.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto.js';

@Controller('admin/cms')
@UseGuards(AuthGuard('jwt'), PlatformRoleGuard)
@PlatformRoles(PlatformRole.SUPER_ADMIN)
export class AdminCmsController {
  constructor(private readonly cmsService: CmsService) {}

  // ==================== CONTENTS ====================
  @Post('contents')
  async createContent(@Request() req: any, @Body() dto: CreateContentDto) {
    return this.cmsService.createContent(req.user, dto);
  }

  @Get('contents')
  async findAllContents(@Query() query: GetContentsQueryDto) {
    return this.cmsService.findAllAdmin(query);
  }

  @Get('contents/:id')
  async findOneContent(@Param('id') id: string) {
    return this.cmsService.findOneAdmin(id);
  }

  @Patch('contents/:id')
  async updateContent(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.cmsService.updateContent(req.user, id, dto);
  }

  @Post('contents/:id/publish')
  async publishContent(@Param('id') id: string) {
    return this.cmsService.publishContent(id);
  }

  @Post('contents/:id/rollback/:revisionId')
  async rollbackRevision(
    @Request() req: any,
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.cmsService.rollbackRevision(req.user, id, revisionId);
  }

  @Delete('contents/:id')
  async deleteContent(@Param('id') id: string) {
    return this.cmsService.deleteContent(id);
  }

  // ==================== CATEGORIES ====================
  @Post('categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.cmsService.createCategory(dto);
  }

  @Get('categories')
  async getCategories() {
    return this.cmsService.getCategories();
  }

  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.cmsService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    return this.cmsService.deleteCategory(id);
  }

  // ==================== TAGS ====================
  @Post('tags')
  async createTag(@Body() dto: CreateTagDto) {
    return this.cmsService.createTag(dto);
  }

  @Get('tags')
  async getTags() {
    return this.cmsService.getTags();
  }

  @Patch('tags/:id')
  async updateTag(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.cmsService.updateTag(id, dto);
  }

  @Delete('tags/:id')
  async deleteTag(@Param('id') id: string) {
    return this.cmsService.deleteTag(id);
  }

  // ==================== MEDIA ====================
  @Post('media')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altText?: string,
  ) {
    return this.cmsService.uploadMedia(req.user, file, altText);
  }

  @Get('media')
  async getMediaList() {
    return this.cmsService.getMediaList();
  }

  @Delete('media/:id')
  async deleteMedia(@Param('id') id: string) {
    return this.cmsService.deleteMedia(id);
  }
}
