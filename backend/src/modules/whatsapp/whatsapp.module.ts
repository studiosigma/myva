import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { IntentRouterService } from './intent-router.service';
import { BriefingService } from './briefing.service';
import { UsersModule } from '../users/users.module';
import { MemoryModule } from '../memory/memory.module';
import { ReminderModule } from '../reminder/reminder.module';
import { TaskModule } from '../task/task.module';
import { ContactModule } from '../contact/contact.module';
import { AIModule } from '../ai/ai.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ConfigModule } from '@nestjs/config';
import { QueuesModule } from '../../queues/queues.module';
import { ExpenseModule } from '../expense/expense.module';

@Module({
  imports: [
    ConfigModule,
    QueuesModule,
    UsersModule,
    MemoryModule,
    ReminderModule,
    TaskModule,
    ContactModule,
    AIModule,
    IntegrationsModule,
    ExpenseModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, IntentRouterService, BriefingService],
  exports: [WhatsAppService, BriefingService],
})
export class WhatsAppModule {}
