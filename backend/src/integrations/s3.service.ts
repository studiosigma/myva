import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_ACCESS_KEY');
    this.bucketName = this.configService.get<string>('S3_BUCKET_NAME') || 'myva-vault';

    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: accessKeyId || 'mock-access-key',
        secretAccessKey: secretAccessKey || 'mock-secret-key',
      },
      forcePathStyle: endpoint ? true : false, // true for MinIO/LocalStack
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    const isMock = this.bucketName === 'myva-vault' && 
      (this.configService.get<string>('S3_ENDPOINT')?.includes('your-custom-s3-endpoint.com') ||
       this.configService.get<string>('S3_ACCESS_KEY_ID') === 'your-access-key-id');

    if (isMock) {
      this.logger.warn(`S3 is running in Mock mode. Saving file locally to key: ${key}`);
      const localPath = path.join(process.cwd(), 'uploads', key);
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(localPath, buffer);
      return key;
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      this.logger.log(`Uploaded file to S3: ${key}`);
      return key; // return key as storage path reference
    } catch (error) {
      this.logger.error(`S3 upload error for key ${key}: ${error.message}`);
      
      // Fallback to local storage in case of connection failure in local development
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`S3 upload failed. Falling back to local storage for local development.`);
        const localPath = path.join(process.cwd(), 'uploads', key);
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(localPath, buffer);
        return key;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const localPath = path.join(process.cwd(), 'uploads', key);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      this.logger.log(`Deleted file from local mock storage: ${key}`);
      return;
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      this.logger.log(`Deleted file from S3: ${key}`);
    } catch (error) {
      this.logger.error(`S3 deletion error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  async getObjectStream(key: string) {
    const localPath = path.join(process.cwd(), 'uploads', key);
    if (fs.existsSync(localPath)) {
      this.logger.log(`Reading file from local mock storage: ${key}`);
      return fs.createReadStream(localPath);
    }

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return response.Body;
    } catch (error) {
      this.logger.error(`S3 getObject error for key ${key}: ${error.message}`);
      throw error;
    }
  }
}
