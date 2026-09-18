import {
  Controller,
  Delete,
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
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

type AuthedRequest = {
  user: { userId: string; email: string };
};

const ParseUUID = ParseUUIDPipe;

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly messagesGateway: MessagesGateway,
  ) {}

  @Get()
  conversations(@Req() req: AuthedRequest) {
    return this.messagesService.conversations(req.user.userId);
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthedRequest) {
    return this.messagesService.getUnreadCount(req.user.userId);
  }

  @Get('search')
  search(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('friendId') friendId?: string,
  ) {
    const query = (q ?? '').trim();
    if (query.length < 2) {
      return this.messagesService.searchMessages(req.user.userId, '', friendId);
    }
    return this.messagesService.searchMessages(
      req.user.userId,
      query.slice(0, 100),
      friendId,
    );
  }

  @Get(':friendId')
  conversation(
    @Req() req: AuthedRequest,
    @Param('friendId', ParseUUID) friendId: string,
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
    @Param('friendId', ParseUUID) friendId: string,
  ) {
    return this.messagesService.markConversationRead(req.user.userId, friendId);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('conversation/:friendId')
  async clearConversation(
    @Req() req: AuthedRequest,
    @Param('friendId', ParseUUID) friendId: string,
  ) {
    const result = await this.messagesService.clearConversation(
      req.user.userId,
      friendId,
    );
    this.messagesGateway.emitConversationCleared(friendId, req.user.userId);
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  async deleteMessage(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUID) id: string,
  ) {
    const message = await this.messagesService.deleteMessage(
      req.user.userId,
      id,
    );
    this.messagesGateway.emitMessageDeleted(message);
    return message;
  }
}