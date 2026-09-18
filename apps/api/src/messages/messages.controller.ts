import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagesService } from './messages.service';

type AuthedRequest = {
  user: { userId: string; email: string };
};

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  conversations(@Req() req: AuthedRequest) {
    return this.messagesService.conversations(req.user.userId);
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthedRequest) {
    return this.messagesService.getUnreadCount(req.user.userId);
  }

  @Get(':friendId')
  conversation(
    @Req() req: AuthedRequest,
    @Param('friendId', ParseUUIDPipe) friendId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.conversation(req.user.userId, friendId, {
      before,
      limit: limit === undefined ? undefined : Number(limit),
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post(':friendId/read')
  markRead(
    @Req() req: AuthedRequest,
    @Param('friendId', ParseUUIDPipe) friendId: string,
  ) {
    return this.messagesService.markConversationRead(req.user.userId, friendId);
  }
}