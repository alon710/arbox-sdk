import { describe, expectTypeOf, it } from 'vitest';
import { Arbox, type ScheduleListParams, type ScheduleListResponse } from '../src';
import { createArboxMock } from '../src/testing';

const arbox = new Arbox({ apiKey: 'k' });

describe('types', () => {
  it('requires the parameters the spec marks as required', () => {
    expectTypeOf<ScheduleListParams>().toHaveProperty('from_date').toEqualTypeOf<string>();
    // @ts-expect-error from_date and to_date are required
    void arbox.schedule.list({});
    // @ts-expect-error schedule_id is required
    void arbox.schedule.book({ user_id: 1 });
  });

  it('lets parameter-free calls skip the params argument', () => {
    expectTypeOf(arbox.locations.list).toBeCallableWith();
  });

  it('types response items from the spec', () => {
    type Item = NonNullable<ScheduleListResponse['data']>[number];
    expectTypeOf<Item>().toHaveProperty('schedule_id').toEqualTypeOf<string | null | undefined>();
  });

  it('only paginates list operations', () => {
    expectTypeOf(arbox.paginate(arbox.leads.list, { limit: 10 })).toEqualTypeOf<
      AsyncGenerator<
        NonNullable<Awaited<ReturnType<typeof arbox.leads.list>>['data']>[number],
        void,
        undefined
      >
    >();
  });

  it('types mock handlers by operation', () => {
    const mock = createArboxMock();
    mock.on('locations.list', { statusCode: 200, data: [], extra: [] });
    // @ts-expect-error statusCode must be 200 or 204
    mock.on('locations.list', { statusCode: 'ok' });
  });
});
