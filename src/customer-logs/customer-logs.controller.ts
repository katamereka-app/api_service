import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerLogsService } from './customer-logs.service.js';

import { PlatformRoleGuard, PlatformRoles } from '../business-claims/guards/platform-role.guard.js';
import { PlatformRole } from '../users/entities/user.entity.js';

@Controller('customer-logs')
export class CustomerLogsController {
  constructor(private readonly customerLogsService: CustomerLogsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('my-logs')
  async getMyLogs(@Request() req: any, @Query('limit') limit?: number) {
    const logs = await this.customerLogsService.getUserLogs(
      req.user.id,
      limit ? Number(limit) : 50,
    );
    return {
      success: true,
      message: 'Berhasil mengambil daftar log aktivitas customer',
      data: logs,
    };
  }

  @UseGuards(AuthGuard('jwt'), PlatformRoleGuard)
  @PlatformRoles(PlatformRole.SUPER_ADMIN)
  @Get()
  async getAllLogs(@Query('limit') limit?: number) {
    const logs = await this.customerLogsService.getAllLogs(limit ? Number(limit) : 100);
    return {
      success: true,
      message: 'Berhasil mengambil seluruh log aktivitas customer',
      data: logs,
    };
  }
}
