import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController, FilePublicController } from './file.controller';
import { IntegrationsModule } from '../../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  controllers: [FileController, FilePublicController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
