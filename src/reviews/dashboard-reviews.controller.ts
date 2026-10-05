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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReviewsService } from './reviews.service.js';
import { DashboardReviewsQueryDto } from './dto/dashboard-reviews-query.dto.js';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto.js';
import { UpdateReviewReplyDto } from './dto/update-review-reply.dto.js';
import { BusinessMemberGuard } from '../business-claims/guards/business-member.guard.js';
import { BusinessRoleGuard, BusinessRoles } from '../business-claims/guards/business-role.guard.js';
import { BusinessRole } from '../businesses/entities/business-member.entity.js';

@Controller('businesses/:businessId')
@UseGuards(AuthGuard('jwt'), BusinessMemberGuard)
export class DashboardReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('dashboard/overview')
  async getDashboardOverview(
    @Param('businessId') businessId: string,
    @Query('range') range?: string,
  ) {
    return this.reviewsService.getDashboardOverview(businessId, range);
  }

  @Get('dashboard/rating-trend')
  async getRatingTrend(
    @Param('businessId') businessId: string,
    @Query('range') range?: string,
  ) {
    return this.reviewsService.getRatingTrend(businessId, range);
  }

  @Get('dashboard/reviews')
  async getDashboardReviews(
    @Param('businessId') businessId: string,
    @Query() query: DashboardReviewsQueryDto,
  ) {
    return this.reviewsService.getDashboardReviews(businessId, query);
  }

  @UseGuards(BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Post('reviews/:reviewId/reply')
  async createReply(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: CreateReviewReplyDto,
  ) {
    return this.reviewsService.createBusinessReply(req.user.id, businessId, reviewId, dto);
  }

  @UseGuards(BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Patch('reviews/:reviewId/reply')
  async updateReply(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: UpdateReviewReplyDto,
  ) {
    return this.reviewsService.updateBusinessReply(req.user.id, businessId, reviewId, dto);
  }

  @UseGuards(BusinessRoleGuard)
  @BusinessRoles(BusinessRole.OWNER, BusinessRole.ADMIN)
  @Delete('reviews/:reviewId/reply')
  async deleteReply(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviewsService.deleteBusinessReply(req.user.id, businessId, reviewId);
  }
}
