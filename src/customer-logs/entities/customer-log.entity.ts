import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

export enum ActionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

@Entity('customer_logs')
export class CustomerLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'action_type',
    type: 'enum',
    enum: ActionType,
  })
  actionType: ActionType;

  @Column({ type: 'jsonb', nullable: true })
  data: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
