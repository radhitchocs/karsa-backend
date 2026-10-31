import { Module } from '@nestjs/common';
import { PresentationsService } from './presentations.service';
import { PresentationsController } from './presentations.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PresentationsService],
  controllers: [PresentationsController],
})
export class PresentationsModule {}
