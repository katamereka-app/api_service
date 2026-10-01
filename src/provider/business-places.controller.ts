import { Controller, Get, Query } from '@nestjs/common';
import { BusinessPlacesService } from './business-places.service.js';

@Controller('business-places')
export class BusinessPlacesController {
  constructor(private readonly businessPlacesService: BusinessPlacesService) {}

  @Get('search')
  async search(
    @Query('keyword') keyword: string = 'hotel',
    @Query('location') location: string = 'Bandung',
    @Query('limit') limit?: number,
  ) {
    const data = await this.businessPlacesService.searchBusinessPlaces(
      keyword,
      location,
      limit ? Number(limit) : 20,
    );
    return {
      success: true,
      message: 'Berhasil mengambil daftar tempat bisnis dengan hierarki fallback',
      total: data.length,
      data,
    };
  }
}
