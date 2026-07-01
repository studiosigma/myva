import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { QueuesModule } from '../../queues/queues.module';

@Module({
  imports: [
    ConfigModule,
    IntegrationsModule,
    QueuesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
