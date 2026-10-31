import { Module } from '@nestjs/common';
import { SessionBuilderService } from './session-builder.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SessionBuilderService],
  exports: [SessionBuilderService],
})
export class SessionBuilderModule {}
