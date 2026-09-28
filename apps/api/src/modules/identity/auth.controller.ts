import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../../config';
import {
  loginBody,
  registerBody,
  type LoginBody,
  type RegisterBody,
  type UserSummary,
} from './auth.schemas';
import { AuthService, type RequestMeta } from './auth.service';
import { clearSessionCookie, setSessionCookie, type CookieSettings } from './session-cookie';
import { CurrentSession, SessionGuard } from './session.guard';
import type { ResolvedSession } from './sessions.service';

function metaOf(request: FastifyRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: String(request.id),
  };
}

@Controller('v1/auth')
export class AuthController {
  private readonly cookies: CookieSettings;

  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.cookies = { secure: config.cookieSecure };
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodPipe(registerBody)) body: RegisterBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: UserSummary }> {
    const { user, session } = await this.auth.register(body, metaOf(request));
    setSessionCookie(reply, session, this.cookies);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginBody)) body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: UserSummary }> {
    const { user, session } = await this.auth.login(body, metaOf(request));
    setSessionCookie(reply, session, this.cookies);
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @CurrentSession() session: ResolvedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.sessionId);
    clearSessionCookie(reply, this.cookies);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logoutAll(
    @CurrentSession() session: ResolvedSession,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logoutAll(session.userId, metaOf(request));
    clearSessionCookie(reply, this.cookies);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentSession() session: ResolvedSession): Promise<{ user: UserSummary }> {
    const user = await this.auth.getSummary(session.userId);
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return { user };
  }
}
