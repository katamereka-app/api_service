import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerLog } from './entities/customer-log.entity.js';
import { CustomerLogsService } from './customer-logs.service.js';
import { CustomerLogsController } from './customer-logs.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CustomerLog])],
  controllers: [CustomerLogsController],
  providers: [CustomerLogsService],
  exports: [CustomerLogsService],
})
export class CustomerLogsModule {}
