import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { UserFavoriteBusiness } from '../businesses/entities/user-favorite-business.entity.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { ProfileController } from './profile.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, Review, UserFavoriteBusiness])],
  controllers: [UsersController, ProfileController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
