import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, Clock } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Authenticated, Public, CurrentSession, type SessionContext } from '../../common/policy';
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
  @Public()
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
  @Public()
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
  @Authenticated({ allowPendingSecondFactor: true })
  async logout(
    @CurrentSession() session: SessionContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.sessionId);
    clearSessionCookie(reply, this.cookies);
  }

  @Post('logout-all')
  @HttpCode(204)
  @Authenticated()
  async logoutAll(
    @CurrentSession() session: SessionContext,
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
  @Authenticated({ allowPendingSecondFactor: true })
  async me(
    @CurrentSession() session: SessionContext,
  ): Promise<{ user: UserSummary; secondFactorPending: boolean }> {
    const user = await this.auth.getSummary(session.userId);
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return { user, secondFactorPending: session.secondFactorPending };
  }
}
