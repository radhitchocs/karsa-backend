import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import { PresentationsService } from './presentations.service';
import { CurrentUser, AuthPayload, PresenterOnly } from '../auth/decorators';

@PresenterOnly()
@Controller('api/presentations')
export class PresentationsController {
  constructor(private readonly svc: PresentationsService) {}

  @Get()
  list(@CurrentUser() user: AuthPayload) {
    return this.svc.list(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() body: { title?: string }) {
    return this.svc.create(user.sub, body.title ?? '');
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.svc.get(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { title?: string },
  ) {
    return this.svc.update(id, user.sub, body);
  }

  @Delete(':id')
  @HttpCode(200)
  delete(@Param('id') id: string, @CurrentUser() user: AuthPayload) {
    return this.svc.delete(id, user.sub);
  }

  @Put(':id/slides')
  putSlides(
    @Param('id') id: string,
    @CurrentUser() user: AuthPayload,
    @Body() body: { slides: unknown; expectedVersion?: number },
  ) {
    return this.svc.putSlides(id, user.sub, body.slides, body.expectedVersion);
  }
}
