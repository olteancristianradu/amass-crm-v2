import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new ForbiddenException({ code: 'NO_USER', message: 'Authentication required' });
    }
    if (!required.includes(req.user.role as UserRole)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `Required role: ${required.join(' or ')}`,
      });
    }
    return true;
  }
}
