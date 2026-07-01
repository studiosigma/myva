import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ReminderProcessor } from './processors/reminder.processor';
import { FileProcessingProcessor } from './processors/file-processing.processor';
import { AIProcessor } from './processors/ai.processor';
import { EmailProcessor } from './processors/email.processor';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AIModule } from '../modules/ai/ai.module';

@Module({
  imports: [
    IntegrationsModule,
    AIModule,
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST') || 'localhost';
        const port = Number(configService.get<any>('REDIS_PORT')) || 6379;
        const password = configService.get<string>('REDIS_PASSWORD') || undefined;
        
        // Enable TLS for cloud Redis providers like Upstash, but not Redis Cloud free tier
        const enableTls = configService.get<string>('REDIS_TLS') === 'true' || host.includes('upstash.io');
        
        return {
          connection: {
            host,
            port,
            password,
            ...(enableTls ? { tls: {} } : {}),
          },
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: { count: 100 },
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };
      },
    }),
    BullModule.registerQueueAsync(
      {
        name: 'reminder_queue',
        inject: ['SHARED_REDIS_CONNECTION'],
        useFactory: (sharedConnection: any) => ({
          connection: sharedConnection,
        }),
      },
      {
        name: 'email_queue',
        inject: ['SHARED_REDIS_CONNECTION'],
        useFactory: (sharedConnection: any) => ({
          connection: sharedConnection,
        }),
      },
      {
        name: 'file_processing_queue',
        inject: ['SHARED_REDIS_CONNECTION'],
        useFactory: (sharedConnection: any) => ({
          connection: sharedConnection,
        }),
      },
      {
        name: 'ai_queue',
        inject: ['SHARED_REDIS_CONNECTION'],
        useFactory: (sharedConnection: any) => ({
          connection: sharedConnection,
        }),
      },
    ),
  ],
  providers: [
    {
      provide: 'SHARED_REDIS_CONNECTION',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST') || 'localhost';
        const port = Number(configService.get<any>('REDIS_PORT')) || 6379;
        const password = configService.get<string>('REDIS_PASSWORD') || undefined;
        const enableTls = configService.get<string>('REDIS_TLS') === 'true' || host.includes('upstash.io');
        
        return new Redis({
          host,
          port,
          password,
          maxRetriesPerRequest: null,
          ...(enableTls ? { tls: {} } : {}),
        });
      },
    },
    ReminderProcessor,
    FileProcessingProcessor,
    AIProcessor,
    EmailProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}
