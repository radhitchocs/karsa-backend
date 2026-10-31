import { Module } from '@nestjs/common';
import { SessionGateway } from './session.gateway';
import { SessionCommandService } from './session-command.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionBuilderModule } from '../session-builder/session-builder.module';
import { ProjectionModule } from '../projection/projection.module';

@Module({
  imports: [PrismaModule, SessionBuilderModule, ProjectionModule],
  providers: [SessionGateway, SessionCommandService],
  exports: [SessionCommandService],
})
export class RealtimeModule {}
