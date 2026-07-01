import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = Number(this.configService.get<any>('REDIS_PORT')) || 6379;
    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;
    const enableTls = this.configService.get<string>('REDIS_TLS') === 'true' || host.includes('upstash.io');

    this.logger.log(`Connecting to Redis at ${host}:${port} (TLS: ${enableTls})`);

    this.client = new Redis({
      host,
      port,
      password,
      ...(enableTls ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        // Exponential backoff with a maximum delay of 30 seconds
        const delay = Math.min(times * 1500, 30000);
        this.logger.warn(`Redis connection failed/lost. Retry attempt #${times} in ${delay}ms...`);
        return delay;
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Successfully connected to Redis cache.');
    });

    this.client.on('error', (err) => {
      // Suppress verbose printing of max clients reached if it's already logged, or log as warning
      if (err.message.includes('max number of clients reached')) {
        this.logger.warn(`Redis Cache Client: Server is at maximum client capacity (${err.message})`);
      } else {
        this.logger.error(`Redis Cache Client Error: ${err.message}`, err.stack);
      }
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(`Failed to get key ${key} from Redis: ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.error(`Failed to set key ${key} in Redis: ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(`Failed to delete key ${key} from Redis: ${err.message}`);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (err) {
      this.logger.error(`Failed to increment key ${key} in Redis: ${err.message}`);
      return 0;
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
