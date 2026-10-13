// What the Tables & QR tab and the print sheet are drawn from (brief S3-07), and what its actions
// answer. Plain data, no I/O, so the client components can import the types.
//
// Nothing here carries a till id (rule 3): a table is its `tb_` id, its number as the till or
// the owner gave it ("12", "VIP"), its area, and its QR token (the admin may read its own tokens).
import type { QrAddressProblem, QrMode } from '@restro/core'

/** One table of the venue as the tab shows it. */
export interface TableRowView {
  /** `tb_…`: the id the actions take. */
  readonly id: string
  /** The number the till (or the owner) gives the table, or null. */
  readonly number: string | null
  /** The name the manager gave it, or null. */
  readonly label: string | null
  /** What the guest page calls it: the manager's name, else the number; null = nothing. */
  readonly shownAs: string | null
  /** False for a hidden table (D95): no code, no guest page. */
  readonly isPublic: boolean
  /** The QR token, or null when the table has no code. */
  readonly token: string | null
  /** The address the code carries, or null (no code, or "our link" has no base address yet). */
  readonly address: string | null
  /** The code as SVG markup (dark on light, always), or null when there is no address. */
  readonly qrSvg: string | null
}

/** The tables of one area (D95), in the area's order. */
export interface HallView {
  /** `ar_…`: the area's id. */
  readonly id: string
  readonly name: string
  /** False for a hidden area (D95): its tables have no codes and no guest page. */
  readonly isPublic: boolean
  readonly tables: readonly TableRowView[]
}

/** The venue's address setting, with its defaults resolved. */
export interface QrSettingsView {
  readonly mode: QrMode
  /** The saved base address, else the default; null when neither exists. */
  readonly baseUrl: string | null
  /** True when `baseUrl` is the default (nothing saved). */
  readonly baseIsDefault: boolean
  /** The app's own address from the environment, or null. */
  readonly defaultBaseUrl: string | null
  readonly ownPattern: string | null
}

/** The whole tab. */
export interface TablesView {
  readonly venueId: string
  readonly venueName: string
  /** An owner or admin: may create, change and turn off codes and save the address. */
  readonly canManage: boolean
  readonly qr: QrSettingsView
  readonly halls: readonly HallView[]
  readonly total: number
  readonly coded: number
  /**
   * The first table with a code (by hall and number), for the address preview and the test link:
   * its token and what the table is called. Null when no table has a code.
   */
  readonly sample: { readonly token: string; readonly shownAs: string | null } | null
}

/** Why an action did not do what was asked. */
export type TablesErrorCode =
  /** The input is not what the action takes. */
  | 'invalid'
  /** Only owners and admins may do this. */
  | 'forbidden'
  /** The table, area or venue is not there (any more). */
  | 'not_found'
  /** The table has neither a number nor a name of its own. */
  | 'no_label'
  /** The table or its area is hidden: it gets no code (D95). */
  | 'hidden'
  /** The venue's areas and tables come from its till: not created, deleted or renumbered here. */
  | 'from_till'
  | 'failed'

/** What an action answers. */
export type TablesActionResult =
  | {
      readonly ok: true
      /**
       * False when the change is saved but the job that updates the public code files could not
       * be queued: the page for a new code does not work yet.
       */
      readonly queued: boolean
      /** `create-all`: how many tables got a code, and how many could not (no name or number). */
      readonly issued?: number
      readonly skippedNoLabel?: number
    }
  | {
      readonly ok: false
      readonly error: TablesErrorCode
      /** For a refused address: which field and what is wrong with it. */
      readonly field?: 'baseUrl' | 'ownPattern'
      readonly problem?: QrAddressProblem
    }
