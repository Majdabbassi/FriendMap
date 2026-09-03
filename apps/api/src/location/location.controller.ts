import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LocationHistoryQueryDto } from './dto/location-history-query.dto';
import { LocationHistoryService } from './location-history.service';

type AuthedRequest = { user: { userId: string } };

@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly history: LocationHistoryService) {}

  @Get('history')
  getHistory(@Req() req: AuthedRequest, @Query() query: LocationHistoryQueryDto) {
    return this.history.getHistory(req.user.userId, query.from, query.to);
  }
}