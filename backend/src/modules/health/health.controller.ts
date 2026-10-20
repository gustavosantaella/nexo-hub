import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthRepository } from './health.repository';

const startedAt = Date.now();

@ApiTags('Sistema')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthRepository) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado del servicio y de la base de datos' })
  async check() {
    let database = 'up';
    try {
      await this.health.ping();
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      database,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
