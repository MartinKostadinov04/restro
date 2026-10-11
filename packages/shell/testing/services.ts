// `stubServices()`: a services binding with nothing in it, for the contract tests of a face. The
// state is empty (no bill, no request, no quote, no receipt) and `dispatch` answers every command
// with `pending`, as a host that has not decided yet would. A face that is rendered with it must
// draw its service controls (when the view model has the services on) and nothing it has not been
// told: the stub never tells it a bill, a waiter on the way or a payment.

import type { CommandResult, GuestCommand, ServiceBinding } from '../src/services'
import { EMPTY_SERVICE_STATE } from '../src/services'

/** An empty state and a `dispatch` that answers `pending`. */
export function stubServices(): ServiceBinding {
  return {
    state: EMPTY_SERVICE_STATE,
    dispatch: (command: GuestCommand): Promise<CommandResult> =>
      Promise.resolve({ actionId: command.actionId, status: 'pending', message: null, ref: null }),
  }
}
