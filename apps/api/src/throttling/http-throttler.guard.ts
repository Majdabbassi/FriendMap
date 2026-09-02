import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  canActivate(context: ExecutionContext) {
    if (context.getType() === 'ws') {
      return Promise.resolve(true);
    }

    return super.canActivate(context);
  }
}