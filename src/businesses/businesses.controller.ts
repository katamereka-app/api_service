import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import 'multer';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { BusinessesService } from './businesses.service.js';
import { CreateBusinessDto, UpdateBusinessDto, AddBusinessMemberDto, SyncGoogleBusinessDto } from './dto/business.dto.js';
import { SyncBusinessesDto } from './dto/sync-businesses.dto.js';
import { GetBusinessesQueryDto } from './dto/get-businesses-query.dto.js';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto.js';
import { BusinessMemberGuard } from '../business-claims/guards/business-member.guard.js';
import { BusinessRoleGuard, BusinessRoles } from '../business-claims/guards/business-role.guard.js';
import { BusinessRole } from './entities/business-member.entity.js';

const imageFileFilter = (req: any, file: Express.Multer.File, callback: any) => {
  if (!file || !file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
    return callback(new BadRequestException('Format file harus berupa gambar (jpg, jpeg, png, webp)'), false);
  }
  callback(null, true);
};

@Controller()
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post('internal/businesses/sync')
  async syncInternal(@Body() dto: SyncBusinessesDto) {
    return this.businessesService.syncBusinesses(dto);
  }

  @Get('businesses')
  async findAll(@Query() query: GetBusinessesQueryDto) {
    return this.businessesService.findAll(query);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my-businesses')
  async getMyBusinesses(@Request() req: any) {
    return this.businessesService.getMyBusinesses(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my-recently-viewed')
  async getRecentlyViewed(@Request() req: any, @Query('limit') limit?: number) {
    return this.businessesService.getRecentlyViewed(req.user.id, limit ? Number(limit) : 30);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('businesses/:businessId/view')
  async recordView(@Request() req: any, @Param('businessId') businessId: string) {
    await this.businessesService.recordBusinessView(req.user.id, businessId);
    return {
      success: true,
      message: 'Berhasil mencatat riwayat penelusuran bisnis',
    };
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard)
  @Get('businesses/:businessId/dashboard')
  async getDashboard(@Request() req: any, @Param('businessId') businessId: string) {
    const business = await this.businessesService.findOne(businessId, req.user.id);
    return {
      message: 'Selamat datang di Business Dashboard Katamereka',
      role: req.businessMember?.role,
      business: business.data,
    };
  }

  // BUSINESS PROFILE MANAGEMENT ENDPOINTS
  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard)
  @Get('businesses/:businessId/profile')
  async getManagedProfile(@Param('businessId') businessId: string) {
    return this.businessesService.getManagedProfile(businessId);
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard, BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Patch('businesses/:businessId/profile')
  async updateProfile(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    return this.businessesService.updateProfile(businessId, req.user.id, dto);
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard, BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Post('businesses/:businessId/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
      fileFilter: imageFileFilter,
    }),
  )
  async uploadLogo(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File gambar logo wajib diunggah');
    }
    return this.businessesService.uploadLogo(businessId, req.user.id, file);
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard, BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Post('businesses/:businessId/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
      fileFilter: imageFileFilter,
    }),
  )
  async uploadCover(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File gambar cover wajib diunggah');
    }
    return this.businessesService.uploadCover(businessId, req.user.id, file);
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard, BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Delete('businesses/:businessId/logo')
  async deleteLogo(@Request() req: any, @Param('businessId') businessId: string) {
    return this.businessesService.deleteLogo(businessId, req.user.id);
  }

  @UseGuards(AuthGuard('jwt'), BusinessMemberGuard, BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Delete('businesses/:businessId/cover')
  async deleteCover(@Request() req: any, @Param('businessId') businessId: string) {
    return this.businessesService.deleteCover(businessId, req.user.id);
  }

  @Get('businesses/public-profile/:slug')
  async getPublicProfile(@Param('slug') slug: string) {
    return this.businessesService.getPublicProfile(slug);
  }

  @Get('businesses/slug/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.businessesService.getPublicProfile(slug);
  }

  @Get('businesses/popular')
  async getPopular(@Query('limit') limit?: number) {
    return this.businessesService.getPopularBusinesses(limit ? Number(limit) : 10);
  }

  // Data-retrieval endpoints for the FE's dynamic sitemap generator (and
  // reusable for category/city filter UI). Must stay declared before
  // `businesses/:id` below, or that catch-all would shadow them.
  @Get('businesses/sitemap')
  async getSitemap() {
    return this.businessesService.getSitemapBusinesses();
  }

  @Get('businesses/categories')
  async getCategories() {
    return this.businessesService.getCategoryFacets();
  }

  @Get('businesses/cities')
  async getCities() {
    return this.businessesService.getCityFacets();
  }

  @Get('businesses/:id')
  async findOne(@Param('id') id: string) {
    return this.businessesService.findOne(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('businesses')
  async create(@Request() req: any, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(req.user.id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('businesses/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateBusinessDto) {
    return this.businessesService.update(id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('businesses/:id/members')
  async addMember(@Param('id') id: string, @Body() dto: AddBusinessMemberDto) {
    return this.businessesService.addMember(id, dto);
  }
}

