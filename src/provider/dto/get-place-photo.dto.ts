import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class GetPlacePhotoDto {
  @IsString()
  @IsNotEmpty()
  geoapify_place_id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsNotEmpty()
  lat: number;

  @IsNumber()
  @IsNotEmpty()
  lon: number;
}
