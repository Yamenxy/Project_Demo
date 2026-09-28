import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, Clock } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../../config';
import {
  loginBody,
  registerBody,
  type LoginBody,
  type RegisterBody,
  type UserSummary,
} from './auth.schemas';
import { AuthService, type SignedIn } from './auth.service';
import { metaOf } from './request-meta';
import {
  clearSessionCookie,
  DEVICE_COOKIE,
  setDeviceCookie,
  setSessionCookie,
  type CookieSettings,
} from './session-cookie';
import { AllowPendingSecondFactor, CurrentSession, SessionGuard } from './session.guard';
import type { ResolvedSession } from './sessions.service';

@Controller('v1/auth')
export class AuthController {
  private readonly cookies: CookieSettings;

  constructor(
    private readonly auth: AuthService,
    private readonly clock: Clock,
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
  ): Promise<{ user: UserSummary; secondFactorRequired: boolean }> {
    const result = await this.auth.register(body, metaOf(request), request.cookies[DEVICE_COOKIE]);
    return this.signedIn(reply, result);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginBody)) body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: UserSummary; secondFactorRequired: boolean }> {
    const result = await this.auth.login(body, metaOf(request), request.cookies[DEVICE_COOKIE]);
    return this.signedIn(reply, result);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @AllowPendingSecondFactor()
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

  private signedIn(
    reply: FastifyReply,
    result: SignedIn,
  ): { user: UserSummary; secondFactorRequired: boolean } {
    setSessionCookie(reply, result.session, this.cookies);
    if (result.device.newToken) {
      setDeviceCookie(reply, result.device.newToken, this.cookies, this.clock.now());
    }
    return { user: result.user, secondFactorRequired: result.user.twoFactorEnabled };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @AllowPendingSecondFactor()
  async me(
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ user: UserSummary; secondFactorPending: boolean }> {
    const user = await this.auth.getSummary(session.userId);
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return { user, secondFactorPending: session.secondFactorPending };
  }
}
