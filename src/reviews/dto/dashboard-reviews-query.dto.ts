import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ReviewSortOption } from './get-reviews-query.dto.js';
import { ReviewSource } from '../entities/review.entity.js';

// `@Type(() => Boolean)` turns any non-empty query string (incl. "false")
// into `true` — use an explicit string comparison for querystring booleans.
function toBoolean({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export enum ReplyStatusFilter {
  ALL = 'ALL',
  REPLIED = 'REPLIED',
  UNREPLIED = 'UNREPLIED',
}

export class DashboardReviewsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rating?: number;

  @IsOptional()
  @IsEnum(ReplyStatusFilter)
  reply_status?: ReplyStatusFilter = ReplyStatusFilter.ALL;

  @IsOptional()
  @IsEnum(ReviewSortOption)
  sort?: ReviewSortOption = ReviewSortOption.NEWEST;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsEnum(ReviewSource)
  source?: ReviewSource;

  @IsOptional()
  @IsString()
  search?: string;

  // When true, only reviews with at least one PENDING report are returned
  // (backs the "Dilaporkan" tab).
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reported?: boolean;
}
