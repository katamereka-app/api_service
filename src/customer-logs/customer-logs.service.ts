import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerLog, ActionType } from './entities/customer-log.entity.js';

@Injectable()
export class CustomerLogsService {
  constructor(
    @InjectRepository(CustomerLog)
    private readonly customerLogRepository: Repository<CustomerLog>,
  ) {}

  async logAction(userId: string, actionType: ActionType, data: any): Promise<CustomerLog> {
    const log = this.customerLogRepository.create({
      userId,
      actionType,
      data,
    });
    return await this.customerLogRepository.save(log);
  }

  async getUserLogs(userId: string, limit = 50) {
    return await this.customerLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getAllLogs(limit = 100) {
    return await this.customerLogRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
