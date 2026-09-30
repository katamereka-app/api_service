import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service.js';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';
import { PlatformRoleGuard, PlatformRoles } from '../business-claims/guards/platform-role.guard.js';
import { PlatformRole } from './entities/user.entity.js';

// Raw user CRUD (list/create/update/delete anyone's role & status) — admin-only.
// Without this, any logged-in USER could PATCH their own role to ADMIN.
@Controller('users')
@UseGuards(AuthGuard('jwt'), PlatformRoleGuard)
@PlatformRoles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
