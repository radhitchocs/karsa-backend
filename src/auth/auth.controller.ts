import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() body: { email: string; password: string }) {
    return this.auth.register(body.email, body.password);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post('logout')
  @HttpCode(200)
  logout() {
    return { ok: true };
  }
}
