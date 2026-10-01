import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './entities/review.entity.js';
import { ReviewReply } from './entities/review-reply.entity.js';
import { ReviewReport } from '../review-reports/entities/review-report.entity.js';
import { Business } from '../businesses/entities/business.entity.js';
import { BusinessMember } from '../businesses/entities/business-member.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ReviewsService } from './reviews.service.js';
import { ReviewsController } from './reviews.controller.js';
import { DashboardReviewsController } from './dashboard-reviews.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Review, ReviewReply, ReviewReport, Business, BusinessMember, User]),
  ],
  controllers: [ReviewsController, DashboardReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
