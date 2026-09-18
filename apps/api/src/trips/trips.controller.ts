import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTripDto } from './dto/create-trip.dto';
import {
  InviteToTripDto,
  RespondInviteDto,
  RespondProposalDto,
  SetMeetupDto,
} from './dto/trip-actions.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsGateway } from './trips.gateway';
import { TripsService } from './trips.service';

type AuthedRequest = {
  user: { userId: string; email: string };
};

@UseGuards(JwtAuthGuard)
@Controller('trips')
export class TripsController {
  constructor(
    private readonly tripsService: TripsService,
    private readonly tripsGateway: TripsGateway,
  ) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() dto: CreateTripDto) {
    const result = await this.tripsService.create(req.user.userId, dto);
    this.tripsGateway.emitTripUpdated(result.trip.id);
    return result;
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.tripsService.listMine(req.user.userId);
  }

  @Get('invites')
  incomingInvites(@Req() req: AuthedRequest) {
    return this.tripsService.listIncomingInvites(req.user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/:inviteId/respond')
  async respondInvite(
    @Req() req: AuthedRequest,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @Body() dto: RespondInviteDto,
  ) {
    const invite = await this.tripsService.respondInvite(
      req.user.userId,
      inviteId,
      dto,
    );
    if (dto.accept) {
      this.tripsGateway.emitTripUpdated(invite.tripId);
    }
    return invite;
  }

  @Get(':id')
  detail(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.getDetail(req.user.userId, id);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ) {
    const trip = await this.tripsService.update(req.user.userId, id, dto);
    this.tripsGateway.emitTripUpdated(id);
    return trip;
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  async archive(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const trip = await this.tripsService.archive(req.user.userId, id);
    this.tripsGateway.emitTripUpdated(id);
    return trip;
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/leave')
  async leave(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.tripsService.leave(req.user.userId, id);
    this.tripsGateway.emitTripUpdated(id);
    return result;
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.tripsService.delete(req.user.userId, id);
    this.tripsGateway.emitTripUpdated(id);
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/invites')
  async invite(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteToTripDto,
  ) {
    const invite = await this.tripsService.invite(req.user.userId, id, dto);
    this.tripsGateway.emitTripUpdated(id);
    return invite;
  }

  @Get(':id/messages')
  messages(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tripsService.messages(req.user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/meetup')
  async setMeetup(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMeetupDto,
  ) {
    const result = await this.tripsService.setMeetup(req.user.userId, id, dto);
    this.tripsGateway.emitTripUpdated(id);
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/meetup/respond')
  async respondProposal(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondProposalDto,
  ) {
    const trip = await this.tripsService.respondProposal(
      req.user.userId,
      id,
      dto,
    );
    this.tripsGateway.emitTripUpdated(id);
    return trip;
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/arrive')
  async arrive(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const member = await this.tripsService.arrive(req.user.userId, id);
    this.tripsGateway.emitMemberArrived(id, req.user.userId, member.arrivedAt);
    return member;
  }
}
