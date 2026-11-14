<div align="center">

# arbox-sdk

**A fully typed TypeScript client for the [Arbox](https://www.arboxapp.com) public API.**

Every v3 endpoint, generated from Arbox's official OpenAPI document. Zero dependencies.

[![npm](https://img.shields.io/npm/v/arbox-sdk?color=cb3837&logo=npm)](https://www.npmjs.com/package/arbox-sdk)
[![CI](https://github.com/alon710/arbox-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/alon710/arbox-sdk/actions/workflows/ci.yml)
[![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](#typescript)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

> [!IMPORTANT]
> This is an **unofficial** client, not made, endorsed or supported by Arbox. It calls only Arbox's official public API (`arboxserver.arboxapp.com/api/public`), which is the only integration route [Arbox's terms](https://arboxapp.com/terms-of-use) allow. You are responsible for using it within those terms.

```ts
import { Arbox } from 'arbox-sdk';

const arbox = new Arbox({ apiKey: process.env.ARBOX_API_KEY });

const { data: classes = [] } = await arbox.schedule.list({
  from_date: '2026-11-16',
  to_date: '2026-11-22',
  registration_count: '1',
});

for (const c of classes) {
  console.log(c.date, c.start_time, c.session_name, `${c.registration_count}/${c.max_participants}`);
}
```

## Why this one

- **The whole API, typed.** All 72 v3 operations across schedule, users, memberships, leads, tasks, messages, reports and finance. Parameters and responses come straight from the official OpenAPI document, so your editor knows every field.
- **Safe by default.** Reads retry on network errors, 408, 429 and 5xx. Writes never retry on a server error, so a flaky network can't book a member twice. Every attempt has a timeout.
- **Typed errors.** `ArboxValidationError` carries the field errors, `ArboxAuthenticationError` the reason, and every error names the operation that failed, without leaking your API key or query values.
- **Read-only mode.** `new Arbox({ readOnly: true })` refuses every write before it leaves your machine. Use it for dashboards, probes and tests against production.
- **A test double included.** `arbox-sdk/testing` gives you an in-memory Arbox with handlers typed per operation.
- **Kept in sync.** A weekly job fetches Arbox's published spec and opens a pull request when it changes.
- **Small and portable.** Zero dependencies, about 8 kB gzipped, ESM and CommonJS. It uses only `fetch`.

## Install

```sh
npm install arbox-sdk
# or
pnpm add arbox-sdk
bun add arbox-sdk
yarn add arbox-sdk
```

Requires Node.js 22 or newer. It only needs `fetch`, so Bun, Deno and edge runtimes should work too; CI tests Node 22, 24 and 26.

## Get an API key

Arbox issues one API key per studio. A studio admin can find it in Arbox under **Settings → Club Information**; if it isn't there, ask Arbox support to enable API access.

The key gives full access to the studio's members and payments, so keep it on your server. The client reads `ARBOX_API_KEY` from the environment when you don't pass `apiKey`, and it refuses to run in a browser unless you opt in with `dangerouslyAllowBrowser: true`.

## Usage

Methods are grouped by resource (`arbox.schedule`, `arbox.users`, `arbox.memberships`, …) and take one object with every parameter, whether it goes in the path, the query string or the body. The SDK puts each one where Arbox expects it. The [full method list](#api-reference) is below.

### Find a member and book them into a class

```ts
const { data: [member] = [] } = await arbox.users.search({ type: 'phone', value: '0501234567' });
if (!member) throw new Error('No member with that phone number');

const { data: [booking] = [] } = await arbox.schedule.book({
  user_id: Number(member.user_id),
  schedule_id: 812345,
});
```

### Cancel a booking

```ts
await arbox.schedule.cancelBooking({ user_id: 1234, schedule_id: 812345 });
```

### Check a member's memberships

```ts
const { data: memberships = [] } = await arbox.memberships.list({ user_id: 1234, active: '1' });
```

### Waiting lists

```ts
const { data: entries = [] } = await arbox.schedule.waitingListEntries({
  from_date: '2026-11-01',
  to_date: '2026-11-30',
});
```

### Responses

Every method returns Arbox's response envelope as-is:

```json
{ "statusCode": 200, "data": [], "extra": [] }
```

Arbox's spec types most fields as strings, including counts and ids (`registration_count: "12"`), so convert them where you need numbers.

### Pagination

List endpoints take `page` and `limit`. `arbox.paginate()` walks the pages for you and stops at the first empty page:

```ts
for await (const lead of arbox.paginate(arbox.leads.list, { limit: 100 })) {
  console.log(lead.first_name, lead.lead_status);
}
```

Pass `{ maxPages }` as the third argument to cap it. It also stops if Arbox returns the same page twice.

### Errors

Every failure is an `ArboxError`. HTTP errors are `ArboxAPIError` subclasses with the status, Arbox's error code, the parsed body and the operation that failed:

```ts
import { ArboxValidationError, ArboxAuthenticationError } from 'arbox-sdk';

try {
  await arbox.schedule.book({ user_id: 1234, schedule_id: 812345 });
} catch (error) {
  if (error instanceof ArboxValidationError) {
    console.log(error.errors); // { schedule_id: ['The class is full.'] }
  } else if (error instanceof ArboxAuthenticationError) {
    console.log(error.code); // 'INVALID API KEY'
  }
  throw error;
}
```

| Error                        | When                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `ArboxAuthenticationError`   | 401: missing or invalid API key                                  |
| `ArboxPermissionDeniedError` | 403                                                              |
| `ArboxNotFoundError`         | 404                                                              |
| `ArboxValidationError`       | 422, with `errors` per field                                     |
| `ArboxRateLimitError`        | 429 after the retries ran out                                    |
| `ArboxServerError`           | 5xx                                                              |
| `ArboxAPIError`              | any other non-2xx status, and the base class of all of the above |
| `ArboxTimeoutError`          | an attempt took longer than `timeoutMs`                          |
| `ArboxConnectionError`       | Arbox couldn't be reached                                        |
| `ArboxReadOnlyError`         | a write on a `readOnly` client                                   |

Messages look like `POST /v3/schedule/bookSession failed with 422: The class is full.` They use the path template, so ids and search values from your request never end up in your logs.

### Retries and timeouts

|                         | Reads (`GET`)                   | Writes                          |
| ----------------------- | ------------------------------- | ------------------------------- |
| Network error           | retried                         | not retried                     |
| 408, 500, 502, 503, 504 | retried                         | not retried                     |
| 429                     | retried, honoring `Retry-After` | retried, honoring `Retry-After` |

Retries back off exponentially with jitter, starting at about 0.5 s. Defaults are 2 retries and a 30 s timeout per attempt. Override them for the client or for a single call:

```ts
const arbox = new Arbox({ maxRetries: 4, timeoutMs: 10_000 });

await arbox.schedule.list(
  { from_date: '2026-11-16', to_date: '2026-11-22' },
  { maxRetries: 0, timeoutMs: 5_000, signal: AbortSignal.timeout(8_000) },
);
```

### Read-only mode

```ts
const arbox = new Arbox({ readOnly: true });

await arbox.locations.list(); // fine
await arbox.schedule.book({ user_id: 1, schedule_id: 2 }); // throws ArboxReadOnlyError, nothing is sent
```

### Client options

| Option                    | Default                                       |                                              |
| ------------------------- | --------------------------------------------- | -------------------------------------------- |
| `apiKey`                  | `process.env.ARBOX_API_KEY`                   | The studio's API key                         |
| `baseUrl`                 | `https://arboxserver.arboxapp.com/api/public` | Point at a proxy or a recording server       |
| `fetch`                   | `globalThis.fetch`                            | Custom fetch for tracing, proxies or tests   |
| `timeoutMs`               | `30000`                                       | Per attempt                                  |
| `maxRetries`              | `2`                                           | Attempts after the first                     |
| `readOnly`                | `false`                                       | Refuse every non-GET call                    |
| `headers`                 | `{}`                                          | Extra headers on every request               |
| `dangerouslyAllowBrowser` | `false`                                       | Allow running in a browser, exposing the key |

Parameters that aren't in the spec yet are passed through: as query parameters for reads, in the body for writes.

## Testing your code

`arbox-sdk/testing` is an in-memory Arbox. Handlers are typed by operation, so a handler for `schedule.list` must return a `schedule.list` response:

```ts
import { createArboxMock, MockResponse } from 'arbox-sdk/testing';

const mock = createArboxMock()
  .on('schedule.list', ({ query }) => ({
    statusCode: 200,
    data: [{ schedule_id: '42', date: query.from_date, session_name: 'Strength', max_participants: '12' }],
    extra: [],
  }))
  .on(
    'schedule.book',
    () =>
      new MockResponse(422, {
        message: 'The class is full.',
        errors: { schedule_id: ['The class is full.'] },
      }),
  );

const arbox = mock.client(); // or new Arbox({ apiKey: 'test', fetch: mock.fetch })

await bookFirstClass(arbox);

expect(mock.callsTo('schedule.book')[0]?.body).toEqual({ user_id: 7, schedule_id: 42 });
```

An operation without a handler fails with a 501 that names it, so a test can't silently hit an endpoint you forgot to mock.

## TypeScript

Every operation has exported `…Params` and `…Response` types, and the raw OpenAPI types are exported as `paths` and `components`:

```ts
import type { ScheduleListParams, ScheduleListResponse, components } from 'arbox-sdk';

type ScheduledClass = NonNullable<ScheduleListResponse['data']>[number];
type Lead = components['schemas']['LeadsResource'];
```

## API reference

<!-- api:start -->

72 methods, generated from the official OpenAPI document.

<details>
<summary><code>arbox.schedule</code>: Classes and sessions: the schedule, bookings, check-ins, waiting lists and trial classes.</summary>

| Method                              | Endpoint                                           | Arbox name                 |
| ----------------------------------- | -------------------------------------------------- | -------------------------- |
| `schedule.list()`                   | `GET /v3/schedule`                                 | Get Schedule               |
| `schedule.book()`                   | `POST /v3/schedule/bookSession`                    | Book Session               |
| `schedule.cancelBooking()`          | `POST /v3/schedule/cancelUserBooking`              | Cancel session             |
| `schedule.checkIn()`                | `POST /v3/schedule/booking/checkIn`                | Check In                   |
| `schedule.cancelLateCancellation()` | `POST /v3/schedule/booking/cancelLateCancellation` | Cancel Late Cancellation   |
| `schedule.waitingListEntries()`     | `GET /v3/schedule/entryFromWaitingList`            | Get Waiting List Entries   |
| `schedule.trialBookings()`          | `GET /v3/schedule/booking/trial`                   | Get Trial Class Bookings   |
| `schedule.bookTrial()`              | `POST /v3/schedule/booking/trial`                  | Book Trial Class           |
| `schedule.cancelTrial()`            | `DELETE /v3/schedule/booking/trial`                | Cancel Trial Booking       |
| `schedule.services()`               | `GET /v3/schedule/boxCategories`                   | Get Services               |
| `schedule.settings()`               | `GET /v3/schedule/boxScheduleSettings`             | Get Schedule Settings      |
| `schedule.staffAvailability()`      | `GET /v3/schedule/staffAvailability`               | Get Staff Availability     |
| `schedule.spaceAvailability()`      | `GET /v3/schedule/spacesAvailability`              | Get Space Availability     |
| `schedule.update()`                 | `PATCH /v3/schedule`                               | Update Class Schedule      |
| `schedule.cancel()`                 | `POST /v3/schedule/cancel`                         | Cancel Schedule            |
| `schedule.restore()`                | `POST /v3/schedule/revive`                         | Restore Cancelled Schedule |

</details>

<details>
<summary><code>arbox.users</code>: Members, leads and staff as Arbox users: search, profile, notes and payments.</summary>

| Method                           | Endpoint                              | Arbox name                  |
| -------------------------------- | ------------------------------------- | --------------------------- |
| `users.list()`                   | `GET /v3/users`                       | Get All Users               |
| `users.get()`                    | `GET /v3/users/{userId}`              | Get user by id              |
| `users.search()`                 | `GET /v3/users/searchUser`            | Search user                 |
| `users.create()`                 | `POST /v3/users`                      | Create New User             |
| `users.update()`                 | `PATCH /v3/users`                     | Update user                 |
| `users.upsertInjury()`           | `PATCH /v3/users/injury`              | Create or update injury     |
| `users.setProfileImage()`        | `POST /v3/users/profileImage`         | Change user profile image   |
| `users.notes()`                  | `GET /v3/users/notes`                 | Get general notes           |
| `users.addNote()`                | `POST /v3/users/createNote`           | Create user note            |
| `users.recurringPayments()`      | `GET /v3/users/recurringPayments`     | Get user recurring payments |
| `users.updateRecurringPayment()` | `POST /v3/users/recurringPayments`    | Edit user recurring payment |
| `users.withWaiver()`             | `GET /v3/users/waiver/{type}/{value}` | Get users with waiver       |
| `users.group()`                  | `POST /v3/users/group`                | Group users                 |
| `users.archive()`                | `DELETE /v3/users/archive`            | Archive user                |
| `users.deletePermanently()`      | `DELETE /v3/users/permanent`          | Delete user permanently     |

</details>

<details>
<summary><code>arbox.memberships</code>: Members' memberships: create, update, hold, cancel and debt.</summary>

| Method                         | Endpoint                              | Arbox name                               |
| ------------------------------ | ------------------------------------- | ---------------------------------------- |
| `memberships.list()`           | `GET /v3/users/memberships`           | Get User Memberships                     |
| `memberships.create()`         | `POST /v3/users/memberships`          | Create User Membership                   |
| `memberships.update()`         | `POST /v3/users/memberships/update`   | Update user membership                   |
| `memberships.hold()`           | `POST /v3/users/memberships/hold`     | Suspend user membership                  |
| `memberships.cancel()`         | `POST /v3/users/memberships/cancel`   | Cancel user membership                   |
| `memberships.debt()`           | `GET /v3/users/memberships/debt`      | Get Membership Debt                      |
| `memberships.createQr()`       | `POST /v3/users/memberships/qr`       | Create Membership QR                     |
| `memberships.attachDocument()` | `POST /v3/users/memberships/document` | Attach commitment document to membership |

</details>

<details>
<summary><code>arbox.membershipTypes</code>: The membership plans a studio sells, plus cancel and hold reasons.</summary>

| Method                            | Endpoint                          | Arbox name               |
| --------------------------------- | --------------------------------- | ------------------------ |
| `membershipTypes.list()`          | `GET /v3/membershipTypes`         | Get All Membership Types |
| `membershipTypes.update()`        | `PATCH /v3/membershipTypes`       | Update Membership Type   |
| `membershipTypes.cancelReasons()` | `GET /v3/membershipCancelReasons` | Get Cancel Reasons       |
| `membershipTypes.holdReasons()`   | `GET /v3/membershipHoldReasons`   | Get Hold Reasons         |

</details>

<details>
<summary><code>arbox.staff</code>: Staff members and their salary report.</summary>

| Method           | Endpoint                        | Arbox name        |
| ---------------- | ------------------------------- | ----------------- |
| `staff.list()`   | `GET /v3/users/allStaffMembers` | Get staff members |
| `staff.salary()` | `GET /v3/users/staffSalary`     | Get Staff Salary  |

</details>

<details>
<summary><code>arbox.leads</code>: Leads: create, update status, convert or lose, and lookup lists.</summary>

| Method                  | Endpoint                      | Arbox name            |
| ----------------------- | ----------------------------- | --------------------- |
| `leads.list()`          | `GET /v3/leads`               | Get All Leads         |
| `leads.create()`        | `POST /v3/leads`              | Create New Lead       |
| `leads.updateStatus()`  | `POST /v3/leads/updateStatus` | Update Lead Status    |
| `leads.markAsLost()`    | `POST /v3/leads/markAsLost`   | Mark Lead as Lost     |
| `leads.addNote()`       | `POST /v3/leads/createNote`   | Add Note to Lead      |
| `leads.listConverted()` | `GET /v3/leads/converted`     | Get Converted Leads   |
| `leads.listLost()`      | `GET /v3/leads/lost`          | Get Lost Leads        |
| `leads.statuses()`      | `GET /v3/statuses`            | Get Lead Statuses     |
| `leads.sources()`       | `GET /v3/sources`             | Get Lead Sources      |
| `leads.lostReasons()`   | `GET /v3/lostReasons`         | Get Lead Lost Reasons |

</details>

<details>
<summary><code>arbox.tasks</code>: Staff tasks.</summary>

| Method             | Endpoint                                   | Arbox name             |
| ------------------ | ------------------------------------------ | ---------------------- |
| `tasks.list()`     | `GET /v3/tasks`                            | Get All Tasks          |
| `tasks.create()`   | `POST /v3/tasks`                           | Create New Task        |
| `tasks.types()`    | `GET /v3/tasks/types`                      | Get Task Types         |
| `tasks.complete()` | `POST /v3/tasks/markAsCompleted/{task_id}` | Mark Task as Completed |

</details>

<details>
<summary><code>arbox.messages</code>: Messages to users and message templates.</summary>

| Method                 | Endpoint                   | Arbox name            |
| ---------------------- | -------------------------- | --------------------- |
| `messages.send()`      | `POST /v3/message`         | Send Message to User  |
| `messages.templates()` | `GET /v3/messageTemplates` | Get Message Templates |

</details>

<details>
<summary><code>arbox.locations</code>: The studio's locations.</summary>

| Method             | Endpoint            | Arbox name        |
| ------------------ | ------------------- | ----------------- |
| `locations.list()` | `GET /v3/locations` | Get All Locations |

</details>

<details>
<summary><code>arbox.customFields</code>: Custom fields defined for users and leads.</summary>

| Method                | Endpoint               | Arbox name        |
| --------------------- | ---------------------- | ----------------- |
| `customFields.list()` | `GET /v3/customFields` | Get Custom Fields |

</details>

<details>
<summary><code>arbox.digitalForms</code>: Digital forms and signing links.</summary>

| Method                      | Endpoint                           | Arbox name               |
| --------------------------- | ---------------------------------- | ------------------------ |
| `digitalForms.list()`       | `GET /v3/digitalForms`             | Get Digital Forms        |
| `digitalForms.createLink()` | `POST /v3/digitalForms/createLink` | Create Digital Form Link |

</details>

<details>
<summary><code>arbox.reports</code>: Built-in Arbox reports, by report name.</summary>

| Method          | Endpoint                       | Arbox name  |
| --------------- | ------------------------------ | ----------- |
| `reports.get()` | `GET /v3/reports/{reportName}` | Get Reports |

</details>

<details>
<summary><code>arbox.finance</code>: Finance reports and documents.</summary>

| Method                         | Endpoint                                     | Arbox name                  |
| ------------------------------ | -------------------------------------------- | --------------------------- |
| `finance.invoices()`           | `GET /v3/finance/reports/invoices`           | Get Invoices Report         |
| `finance.receipts()`           | `GET /v3/finance/reports/receipts`           | Get Receipts Report         |
| `finance.cashFlow()`           | `GET /v3/finance/reports/cashFlow`           | Get Cash Flow Report        |
| `finance.sales()`              | `GET /v3/finance/reports/sales`              | Get Sales By Invoice Report |
| `finance.failedTransactions()` | `GET /v3/finance/reports/failedTransactions` | Get Failed Transactions     |
| `finance.createDocument()`     | `POST /v3/finance/documents`                 | Create Document             |

</details>

<!-- api:end -->

## How it stays in sync

Arbox publishes its API as an OpenAPI 3.1 document on its [docs page](https://arboxserver.arboxapp.com/docs/api). This repo keeps a snapshot in [`openapi/arbox.json`](openapi/arbox.json) and generates the types, the request table and the resource classes from it ([`scripts/generate.ts`](scripts/generate.ts)). Method names are the only hand-written part ([`scripts/names.ts`](scripts/names.ts)), and a test fails if any operation in the spec has no method.

Every Monday a workflow fetches the latest document, regenerates the client and opens a pull request if anything changed.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the generator, live tests and how releases work.

## License

[MIT](LICENSE). Arbox is a trademark of its owner; this project is not affiliated with it.
