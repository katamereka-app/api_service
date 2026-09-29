import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTagDto {
  @IsNotEmpty({ message: 'Nama tag wajib diisi' })
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;
}
