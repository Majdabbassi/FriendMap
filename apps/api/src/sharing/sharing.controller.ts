import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SharingListType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SharingListQueryDto } from './dto/sharing-list-query.dto';
import { UpdateSharingListDto } from './dto/update-sharing-list.dto';
import { UpdateSharingSettingsDto } from './dto/update-sharing-settings.dto';
import { SharingService } from './sharing.service';

type AuthedRequest = {
  user: { userId: string; email: string };
};

@UseGuards(JwtAuthGuard)
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharingService: SharingService) {}

  @Get('settings')
  getSettings(@Req() req: AuthedRequest) {
    return this.sharingService.getSettings(req.user.userId);
  }

  @Patch('settings')
  updateSettings(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateSharingSettingsDto,
  ) {
    return this.sharingService.updateSettings(req.user.userId, dto);
  }

  @Post('list')
  addToList(@Req() req: AuthedRequest, @Body() dto: UpdateSharingListDto) {
    return this.sharingService.addToList(req.user.userId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('list/:friendId/:listType')
  removeFromList(
    @Req() req: AuthedRequest,
    @Param('friendId', ParseUUIDPipe) friendId: string,
    @Param('listType', new ParseEnumPipe(SharingListType)) listType: SharingListType,
  ) {
    return this.sharingService.removeFromList(
      req.user.userId,
      friendId,
      listType,
    );
  }

  @Get('list')
  getList(
    @Req() req: AuthedRequest,
    @Query() query: SharingListQueryDto,
  ) {
    return this.sharingService.getList(req.user.userId, query.type);
  }
}