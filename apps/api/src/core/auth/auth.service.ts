import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), active: true },
    });
    if (!user) throw new UnauthorizedException('بيانات الدخول غير صحيحة');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('بيانات الدخول غير صحيحة');

    const tokens = await this.issueTokens(user, ip, userAgent);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`Login OK: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Token غير صالح');
    }

    // Rotate
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.user, ip, userAgent);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.updateMany({
      where: { refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException();
    return this.sanitizeUser(user);
  }

  /** تغيير كلمة المرور للمستخدم الحالي */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('كلمة المرور الحالية غير صحيحة');

    if (newPassword.length < 6)
      throw new BadRequestException('كلمة المرور الجديدة قصيرة جداً');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // إلغاء كل الجلسات الأخرى لإجبار إعادة الدخول
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Password changed: ${user.email}`);
    return { ok: true };
  }

  private async issueTokens(user: any, ip?: string, userAgent?: string) {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        ip,
        userAgent,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
    };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
