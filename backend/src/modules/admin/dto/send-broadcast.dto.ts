import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendBroadcastDto {
  @ApiProperty({ example: 'Pemberitahuan Sistem' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Halo, kami baru saja memperbarui...' })
  @IsString()
  message: string;

  @ApiProperty({ example: 'whatsapp', enum: ['whatsapp', 'email', 'both'] })
  @IsEnum(['whatsapp', 'email', 'both'])
  channel: 'whatsapp' | 'email' | 'both';

  @ApiProperty({ example: 'all', enum: ['all', 'free', 'basic', 'pro'] })
  @IsEnum(['all', 'free', 'basic', 'pro'])
  audience: 'all' | 'free' | 'basic' | 'pro';
}
