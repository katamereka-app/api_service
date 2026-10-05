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
import { CreateReviewDto } from './dto/create-review.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { GetReviewsQueryDto } from './dto/get-reviews-query.dto.js';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('my-reviews')
  async getMyReviews(@Request() req: any) {
    return this.reviewsService.getMyReviews(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('businesses/:businessId/reviews')
  async createReview(
    @Request() req: any,
    @Param('businessId') businessId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(req.user.id, businessId, dto);
  }

  @Get('businesses/:businessId/reviews')
  async findBusinessReviews(
    @Param('businessId') businessId: string,
    @Query() query: GetReviewsQueryDto,
  ) {
    return this.reviewsService.findBusinessReviews(businessId, query);
  }

  @Get('businesses/:businessId/review-summary')
  async getReviewSummary(
    @Param('businessId') businessId: string,
    @Query('range') range?: string,
  ) {
    return this.reviewsService.getReviewSummary(businessId, range);
  }

  @Get('reviews/:id')
  async findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('reviews/:id')
  async updateReview(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.updateReview(req.user.id, id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('reviews/:id')
  async deleteReview(@Request() req: any, @Param('id') id: string) {
    return this.reviewsService.deleteReview(req.user.id, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('reviews/:id/helpful')
  async toggleHelpful(@Request() req: any, @Param('id') id: string) {
    return this.reviewsService.toggleHelpful(req.user.id, id);
  }
}
