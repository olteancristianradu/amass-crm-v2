import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CallScriptsService } from './call-scripts.service';

const SetCallScriptSchema = z.object({
  points: z.array(z.string().trim().min(1).max(300)).max(50),
});

@Controller('call-scripts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CallScriptsController {
  constructor(private readonly svc: CallScriptsService) {}

  /** All authenticated users can read so the agent UI can show the script. */
  @Get('default')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  getDefault() {
    return this.svc.getDefault();
  }

  /** Only OWNER/ADMIN can change the script — it affects every recorded call. */
  @Put('default')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  setDefault(@Body(new ZodValidationPipe(SetCallScriptSchema)) dto: { points: string[] }) {
    return this.svc.setDefault(dto.points);
  }
}
