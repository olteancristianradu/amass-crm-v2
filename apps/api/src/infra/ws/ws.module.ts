import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { WsGateway } from './ws.gateway';

@Module({
  imports: [RedisModule],
  providers: [WsGateway],
  exports: [WsGateway],
})
export class WsModule {}
