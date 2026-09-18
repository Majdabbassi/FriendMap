import { validate } from 'class-validator';
import { StopViewingDto } from './stop-viewing.dto';

describe('StopViewingDto', () => {
  it.each([
    [{}, 'missing friendId'],
    [{ friendId: 'not-a-uuid' }, 'non-UUID friendId'],
  ])('rejects %s', async (payload) => {
    const errors = await validate(Object.assign(new StopViewingDto(), payload));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('friendId');
  });

  it('accepts a UUID friendId', async () => {
    const errors = await validate(
      Object.assign(new StopViewingDto(), {
        friendId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );

    expect(errors).toHaveLength(0);
  });
});