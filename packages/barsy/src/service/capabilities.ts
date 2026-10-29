// What barsy lets Restro do and read during service (D122 §3), each from the signed-in reading
// of docs.lukanet.com on 2026-10-18 (docs/deliverables/2026-10-18-barsy-api-reference.md). True
// only where a page states it; false where a page says nothing or the question is still open
// with Lukanet (docs/connector-questions.md). A declaration is what barsy allows, not what this
// package already calls: the reads and writes behind most of these come with ordering on barsy.

import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from '@restro/core'

export const BARSY_SERVICE_CAPABILITIES: ServiceCapabilities = {
  ...NO_SERVICE_CAPABILITIES,
  // OrderData.user_name, "who placed it" (methods/accounts/get.html); C52's late landing is open.
  whoEnteredLine: true,
  // Accounts_divide takes "items and quantities to move" (methods/accounts/divide.html).
  movePartOfLineQuantity: true,
  // Places_getlistwithaccountsonly counts open bills per table; Accounts_mergebyplaceid merges
  // "all open bills on a table" (methods/places/getlistwithaccountsonly.html).
  severalBillsPerTable: true,
  // Accounts_place without account_id creates a new bill; place_id is optional
  // (methods/accounts/place.html).
  firstItemsOpenBill: true,
  // Accounts_getlist filters status 1, closed (methods/accounts/getlist.html).
  readClosedBills: true,
  // Accounts_close takes payments with a paymethod_id (methods/accounts/close.html).
  closeWithPaymentType: true,
  // Accounts_place with payments and flag_close_account (methods/accounts/place.html).
  openPayCloseInOneCall: true,
  // AccountData.create_date (methods/accounts/get.html).
  billOpeningTime: true,
  // Not claimed:
  //   approvalAtBar: service_status_id 2 "waiting for approval" exists, but how a cash desk's
  //     approval mode treats an API order is not stated (D120's pre-opening check);
  //   moveLinesToTable: Accounts_divide splits on the same table and Accounts_move moves a whole
  //     bill, two calls, not one move of lines (#51 §1: barsy isolates by divide);
  //   tableBar: barsy has halls (salons), which are areas, not bars (D122 §2, D124 §1);
  //   notesReachTicket, receiptNumberOnClose, trainingMode, itemAvailability: not stated;
  //   electronicReceipt, electronicReceiptFile: not stated; asked of Lukanet (open-items Q84);
  //   ownLineReference: order_ref_id exists, how it is set is not stated (C21, Q82.3);
  //   idempotentAdd: account.uuid guards a new bill only; a repeated add is open (C20);
  //   addToStaffOpenedBill: Accounts_place continues a bill by account_id, but the docs are
  //     silent on whose bill; AccountData's is_locked and per-user user_can_edit suggest limits
  //     whose meaning for an API write is not stated (C54);
  //   recordTipOnClose: whether the API can add the "Бакшиш" item to a bill, and its fiscal
  //     setup, wait on Lukanet (D127 §Open); until then no tip is offered on barsy.
}
