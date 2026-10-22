// What the Tables & QR tab and the print sheet are drawn from (briefs S3-07 and S5), and what its
// actions answer. Plain data, no I/O, so the client components can import the types.
//
// Nothing here carries a till id (rule 3): a table is its `tb_` id, its number as the till or
// the owner gave it ("12", "VIP"), its area, and its QR token (the admin may read its own tokens).

/** Where the menu a table or an area shows comes from (D95): its own entry, the area's, the venue's. */
export type MenuLevel = 'table' | 'area' | 'venue'

/** The menu a code opens, as the guest gets it, and which level chose it. */
export interface MenuShown<Level extends MenuLevel = MenuLevel> {
  /** `nd_…`: the menu's id. */
  readonly id: string
  /** The name the admin lists it by (its header name, else the venue's name). */
  readonly name: string
  readonly level: Level
}

/** One of the venue's menus a route can name (the ones in the bin are not offered). */
export interface MenuChoice {
  readonly id: string
  readonly name: string
  /** True for the venue's live menu: the default of every area and table. */
  readonly live: boolean
}

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
  /** False for a hidden table (D95): no code that leads anywhere, no guest page. */
  readonly isPublic: boolean
  /** True when the table has a code (stored as its hash and a sealed copy, #70). */
  readonly hasCode: boolean
  /**
   * The address the code carries, or null: no code, the installation has no address yet, or the
   * code was not revealed (only owners and admins see codes, through the worker).
   */
  readonly address: string | null
  /** The code as SVG markup (dark on light, always), or null when there is no address or the table is hidden. */
  readonly qrSvg: string | null
  /** The menu a guest who scans the code gets, or null when the venue has nothing published. */
  readonly menu: MenuShown | null
  /** The menu the table's own entry names, or null (it takes its area's). */
  readonly routeMenuId: string | null
}

/** The tables of one area (D95), in the area's order. */
export interface HallView {
  /** `ar_…`: the area's id. */
  readonly id: string
  readonly name: string
  /** False for a hidden area (D95): its tables have no codes and no guest page. */
  readonly isPublic: boolean
  /** The menu the area's tables show unless they choose their own, or null (nothing published). */
  readonly menu: MenuShown<'area' | 'venue'> | null
  /** The menu the area's own entry names, or null (it takes the venue's live menu). */
  readonly routeMenuId: string | null
  readonly tables: readonly TableRowView[]
}

/** The whole tab. */
export interface TablesView {
  readonly venueId: string
  readonly venueName: string
  /** An owner or admin: may create, change and turn off codes and edit areas and tables. */
  readonly canManage: boolean
  /** True when a till serves the venue: its areas and tables are the till's (D95). */
  readonly fromTill: boolean
  /** The till's name for `{source}`; '' when the venue is made by hand. */
  readonly sourceLabel: string
  /**
   * The address of this installation, without a trailing slash: the codes lead to
   * `<baseUrl>/t/<token>` (D94). Null when the installation has no usable address configured.
   */
  readonly baseUrl: string | null
  /** The venue's menus a route can name, in the venue's order. */
  readonly menus: readonly MenuChoice[]
  readonly halls: readonly HallView[]
  readonly total: number
  /** Tables with a code that leads somewhere (a hidden table's paused code is not counted). */
  readonly coded: number
  /**
   * The first table with a code that was revealed (by area and number), for the test link: its
   * code and what the table is called. Null when no table has one.
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
  /** The menu is not one of the venue's, or it is in the bin. */
  | 'unknown_menu'
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
    }
