import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { PlacesService } from './places.service.js';
import { GetPlacePhotoDto } from './dto/get-place-photo.dto.js';

@Controller('places')
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Post('photo')
  async getPlacePhoto(@Body() dto: GetPlacePhotoDto) {
    return this.placesService.getPlacePhoto(dto);
  }

  @Get(':geoapifyPlaceId/photo')
  async getPhotoByPlaceId(@Param('geoapifyPlaceId') geoapifyPlaceId: string) {
    return this.placesService.getPhotoByPlaceId(geoapifyPlaceId);
  }
}
