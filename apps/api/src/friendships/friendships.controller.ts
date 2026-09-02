import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateFriendshipRequestDto } from './dto/create-friendship-request.dto';
import { FriendshipsService } from './friendships.service';

type AuthedRequest = {
  user: { userId: string; email: string };
};

@UseGuards(JwtAuthGuard)
@Controller('friendships')
export class FriendshipsController {
  constructor(private readonly friendshipsService: FriendshipsService) {}

  @Post('request')
  request(@Req() req: AuthedRequest, @Body() dto: CreateFriendshipRequestDto) {
    return this.friendshipsService.request(req.user.userId, dto);
  }

  @Get('pending')
  listPending(@Req() req: AuthedRequest) {
    return this.friendshipsService.listIncomingPending(req.user.userId);
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.friendshipsService.listAccepted(req.user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friendshipsService.accept(req.user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friendshipsService.reject(req.user.userId, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  unfriend(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friendshipsService.unfriend(req.user.userId, id);
  }
}
