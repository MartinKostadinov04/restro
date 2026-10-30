// The design contract (D128, D129, D130): the one list of what a venue can choose for its guest
// page. 14 pages, 48 options, the allowed values of each (Basic's value first, D130's order), the
// `data-design-part` markers each page owns, and the English and Bulgarian label of every page,
// option and value (.claude/skills/template-review/references/copy-rules.md).
//
// Everything that needs the list reads it from here: the design record and its snapshot block, the
// renderer, the Studio's pages and tiles, the leak guard's allowed words and every Style file.
// Nothing else in the repo lists an option's values: the theme's font list takes its ids from the
// Body font row. docs/decisions/D130.md is the same table in words; scripts/design-contract.test.ts
// fails when either changes alone.
//
// It lives in core, not in the shell that re-exports it, because core's design record, snapshot
// schema and leak guard check against it and core sits below the shell (the shell imports core).
//
// Mirrors the Platform's passport-design-contract.json, without the passport's `show` parts
// (content is content, D129) and without a mode gate (Simple hides pages, it never ignores a
// stored value). Pure data: no imports, so a script can read it.

/** The English and the Bulgarian text of one name. */
export interface DesignLabel {
  readonly en: string
  readonly bg: string
}

/** One allowed value of an option: a short lower-case token and its labels. */
export interface DesignValue extends DesignLabel {
  readonly id: string
}

/** An option whose value comes from a fixed list. */
export interface DesignChoiceOption extends DesignLabel {
  readonly id: string
  readonly kind: 'choice'
  readonly values: readonly [DesignValue, ...DesignValue[]]
  /** The venue's own brand, which no Style sets (D128): the body font. */
  readonly brand?: true
}

/** The Style a design came from: Restro's premade ones are listed, an organisation's are not. */
export interface DesignStyleOption extends DesignLabel {
  readonly id: string
  readonly kind: 'style'
  readonly values: readonly [DesignValue, ...DesignValue[]]
}

/** The venue's three colours and the Advanced roles: the one free value (D70, D93). */
export interface DesignColoursOption extends DesignLabel {
  readonly id: string
  readonly kind: 'colours'
}

export type DesignOption = DesignChoiceOption | DesignStyleOption | DesignColoursOption

/** One page of the Studio's Design: a component of the guest page and the options it owns. */
export interface DesignPage extends DesignLabel {
  readonly id: string
  /** The `data-design-part` markers whose tap opens this page. */
  readonly markers: readonly string[]
  readonly options: readonly [DesignOption, ...DesignOption[]]
}

// Values used on more than one row.
const S = { id: 's', en: 'Small', bg: 'Малък' } as const
const M = { id: 'm', en: 'Medium', bg: 'Среден' } as const
const L = { id: 'l', en: 'Large', bg: 'Голям' } as const
const XL = { id: 'xl', en: 'Extra large', bg: 'Много голям' } as const
const BOLD = { id: 'bold', en: 'Bold', bg: 'Получер' } as const
const REGULAR = { id: 'regular', en: 'Regular', bg: 'Нормален' } as const
const HEAVY = { id: 'heavy', en: 'Heavy', bg: 'Много получер' } as const
const WRITTEN = { id: 'written', en: 'As written', bg: 'Както е написано' } as const
const CAPITALS = { id: 'capitals', en: 'Capitals', bg: 'Главни букви' } as const
const PANEL = { id: 'panel', en: 'Panel colour', bg: 'Цвят на панела' } as const
const PAGE = { id: 'page', en: 'Page colour', bg: 'Цвят на страницата' } as const
const INK = { id: 'ink', en: 'Ink', bg: 'Като текста' } as const
const SQUARE = { id: 'square', en: 'Square', bg: 'Прави' } as const
const ROUND = { id: 'round', en: 'Round', bg: 'Заоблени' } as const
const RULED = { id: 'ruled', en: 'Ruled', bg: 'С линии' } as const
const ROWS = { id: 'rows', en: 'Rows', bg: 'Редове' } as const
const LIST = { id: 'list', en: 'List', bg: 'Списък' } as const
const CENTRED = { id: 'centred', en: 'Centred', bg: 'Центрирано' } as const
const ON = { id: 'on', en: 'On', bg: 'Включено' } as const
const OFF = { id: 'off', en: 'Off', bg: 'Изключено' } as const
const SAME = { id: 'same', en: 'Same as body font', bg: 'Като основния шрифт' } as const

// The six fonts with Cyrillic letters (D70); a font's name is the same in both languages.
const INTER = { id: 'inter', en: 'Inter', bg: 'Inter' } as const
const MANROPE = { id: 'manrope', en: 'Manrope', bg: 'Manrope' } as const
const MONTSERRAT = { id: 'montserrat', en: 'Montserrat', bg: 'Montserrat' } as const
const PLAYFAIR = { id: 'playfair-display', en: 'Playfair Display', bg: 'Playfair Display' } as const
const LORA = { id: 'lora', en: 'Lora', bg: 'Lora' } as const
const UNBOUNDED = { id: 'unbounded', en: 'Unbounded', bg: 'Unbounded' } as const

/** The pages, in the order the Studio shows them; the options in D130's order. */
export const DESIGN_PAGES = [
  {
    id: 'general',
    en: 'General',
    bg: 'Общи',
    markers: ['button'],
    options: [
      {
        id: 'style',
        kind: 'style',
        en: 'Style',
        bg: 'Стил',
        // Restro's premade Styles; an organisation's own Styles are records, not part of the list.
        values: [
          { id: 'basic', en: 'Basic', bg: 'Basic' },
          { id: 'editorial', en: 'Editorial', bg: 'Editorial' },
          { id: 'soft', en: 'Soft', bg: 'Soft' },
          { id: 'classic', en: 'Classic', bg: 'Classic' },
          { id: 'club', en: 'Club', bg: 'Club' },
        ],
      },
      { id: 'colours', kind: 'colours', en: 'Colours', bg: 'Цветове' },
      {
        id: 'screen',
        kind: 'choice',
        en: 'Screen',
        bg: 'Екран',
        values: [
          { id: 'auto', en: 'Follows the phone', bg: 'Според телефона' },
          { id: 'light', en: 'Light', bg: 'Светъл' },
          { id: 'dark', en: 'Dark', bg: 'Тъмен' },
        ],
      },
      {
        id: 'body_font',
        kind: 'choice',
        brand: true,
        en: 'Body font',
        bg: 'Основен шрифт',
        values: [INTER, MANROPE, MONTSERRAT, PLAYFAIR, LORA, UNBOUNDED],
      },
      {
        id: 'heading_font',
        kind: 'choice',
        en: 'Heading font',
        bg: 'Шрифт на заглавията',
        values: [SAME, INTER, MANROPE, MONTSERRAT, PLAYFAIR, LORA, UNBOUNDED],
      },
      {
        id: 'heading_weight',
        kind: 'choice',
        en: 'Heading weight',
        bg: 'Тежест на заглавията',
        values: [BOLD, REGULAR, HEAVY],
      },
      {
        id: 'corners',
        kind: 'choice',
        en: 'Corners',
        bg: 'Ъгли',
        values: [
          { id: 'soft', en: 'Soft', bg: 'Меки' },
          SQUARE,
          ROUND,
          { id: 'extra', en: 'Extra round', bg: 'Много заоблени' },
        ],
      },
      {
        id: 'depth',
        kind: 'choice',
        en: 'Depth',
        bg: 'Дълбочина',
        values: [
          { id: 'low', en: 'Light shadow', bg: 'Лека сянка' },
          { id: 'none', en: 'Flat', bg: 'Без сянка' },
        ],
      },
      {
        id: 'density',
        kind: 'choice',
        en: 'Density',
        bg: 'Плътност',
        values: [
          { id: 'comfortable', en: 'Comfortable', bg: 'Удобна' },
          { id: 'compact', en: 'Tight', bg: 'Стегната' },
          { id: 'spacious', en: 'Spacious', bg: 'Просторна' },
        ],
      },
      {
        id: 'text_size',
        kind: 'choice',
        en: 'Text size',
        bg: 'Размер на текста',
        values: [
          { id: 'standard', en: 'Standard', bg: 'Стандартен' },
          { id: 'large', en: 'Large', bg: 'Голям' },
        ],
      },
      {
        id: 'buttons',
        kind: 'choice',
        en: 'Buttons',
        bg: 'Бутони',
        values: [{ id: 'accent', en: 'Accent colour', bg: 'Акцентен цвят' }, INK],
      },
    ],
  },
  {
    id: 'header',
    en: 'Header',
    bg: 'Заглавна част',
    markers: ['header', 'header.logo', 'header.title'],
    options: [
      { id: 'band', kind: 'choice', en: 'Band', bg: 'Лента', values: [PAGE, PANEL, INK] },
      {
        id: 'arrangement',
        kind: 'choice',
        en: 'Arrangement',
        bg: 'Подредба',
        values: [
          { id: 'stacked', en: 'Stacked', bg: 'Една под друга' },
          { id: 'centred', en: 'Centred', bg: 'Центрирана' },
          { id: 'compact', en: 'One line', bg: 'На един ред' },
        ],
      },
      {
        id: 'title_size',
        kind: 'choice',
        en: 'Title size',
        bg: 'Размер на заглавието',
        values: [M, S, L, XL],
      },
      {
        id: 'logo_size',
        kind: 'choice',
        en: 'Logo size',
        bg: 'Размер на логото',
        values: [M, S, L],
      },
    ],
  },
  {
    id: 'navigation',
    en: 'Navigation',
    bg: 'Навигация',
    markers: ['nav'],
    options: [
      {
        id: 'marker',
        kind: 'choice',
        en: 'Marker',
        bg: 'Означение на раздела',
        values: [
          { id: 'underline', en: 'Underline', bg: 'Подчертаване' },
          { id: 'pills', en: 'Pills', bg: 'Заоблени бутони' },
        ],
      },
      {
        id: 'band',
        kind: 'choice',
        en: 'Band',
        bg: 'Лента',
        values: [PAGE, { id: 'header', en: 'Header band', bg: 'Като заглавната част' }],
      },
    ],
  },
  {
    id: 'sections',
    en: 'Sections',
    bg: 'Секции',
    markers: ['section', 'section.title', 'strip'],
    options: [
      {
        id: 'header',
        kind: 'choice',
        en: 'Header',
        bg: 'Заглавие',
        values: [
          RULED,
          { id: 'plain', en: 'Plain', bg: 'Просто' },
          CENTRED,
          { id: 'band', en: 'On a band', bg: 'На лента' },
        ],
      },
      {
        id: 'title_size',
        kind: 'choice',
        en: 'Title size',
        bg: 'Размер на заглавието',
        values: [M, S, L],
      },
      {
        id: 'title_case',
        kind: 'choice',
        en: 'Title case',
        bg: 'Регистър на заглавието',
        values: [WRITTEN, CAPITALS],
      },
      {
        id: 'strip_card_size',
        kind: 'choice',
        en: 'Strip card size',
        bg: 'Размер на картите в лентата',
        values: [M, S, L],
      },
    ],
  },
  {
    id: 'items',
    en: 'Items',
    bg: 'Артикули',
    markers: [
      'item',
      'item.name',
      'item.price',
      'item.description',
      'item.choices',
      'layout.switch',
    ],
    options: [
      {
        id: 'frame',
        kind: 'choice',
        en: 'Frame',
        bg: 'Рамка',
        values: [
          ROWS,
          { id: 'cards', en: 'Cards', bg: 'Картички' },
          { id: 'open', en: 'Open', bg: 'Без рамка' },
        ],
      },
      {
        id: 'name_size',
        kind: 'choice',
        en: 'Name size',
        bg: 'Размер на името',
        values: [M, S, L],
      },
      {
        id: 'name_weight',
        kind: 'choice',
        en: 'Name weight',
        bg: 'Тежест на името',
        values: [BOLD, REGULAR, HEAVY],
      },
      {
        id: 'name_case',
        kind: 'choice',
        en: 'Name case',
        bg: 'Регистър на името',
        values: [WRITTEN, CAPITALS],
      },
      {
        id: 'price_place',
        kind: 'choice',
        en: 'Price place',
        bg: 'Място на цената',
        values: [
          { id: 'end', en: 'At the end', bg: 'В края' },
          { id: 'under', en: 'Under the name', bg: 'Под името' },
        ],
      },
      {
        id: 'portion_place',
        kind: 'choice',
        en: 'Portion place',
        bg: 'Място на порцията',
        values: [
          { id: 'beside', en: 'Beside the price', bg: 'До цената' },
          { id: 'own', en: 'On its own line', bg: 'На отделен ред' },
        ],
      },
      {
        id: 'description_lines',
        kind: 'choice',
        en: 'Description lines',
        bg: 'Редове на описанието',
        values: [
          { id: '2', en: '2 lines', bg: '2 реда' },
          { id: '1', en: '1 line', bg: '1 ред' },
          { id: '3', en: '3 lines', bg: '3 реда' },
          { id: 'all', en: 'All', bg: 'Всички' },
        ],
      },
      {
        id: 'layout',
        kind: 'choice',
        en: 'Layout',
        bg: 'Подредба',
        values: [
          LIST,
          { id: 'one', en: 'One column', bg: 'Една колона' },
          { id: 'two', en: 'Two columns', bg: 'Две колони' },
        ],
      },
      {
        id: 'guest_switch',
        kind: 'choice',
        en: 'Guest switch',
        bg: 'Превключване от госта',
        values: [ON, OFF],
      },
    ],
  },
  {
    id: 'photos',
    en: 'Photos',
    bg: 'Снимки',
    markers: ['item.photo'],
    options: [
      {
        id: 'shape',
        kind: 'choice',
        en: 'Shape',
        bg: 'Форма',
        values: [
          { id: 'landscape', en: 'Landscape 4:3', bg: 'Хоризонтална 4:3' },
          { id: 'square', en: 'Square 1:1', bg: 'Квадратна 1:1' },
          { id: 'wide', en: 'Wide 16:9', bg: 'Широка 16:9' },
          { id: 'portrait', en: 'Portrait 4:5', bg: 'Вертикална 4:5' },
        ],
      },
      {
        id: 'fit',
        kind: 'choice',
        en: 'Fit',
        bg: 'Побиране на снимката',
        values: [
          { id: 'cover', en: 'Fill the frame', bg: 'Запълва рамката' },
          { id: 'contain', en: 'Show whole photo', bg: 'Цялата снимка' },
        ],
      },
      {
        id: 'backdrop',
        kind: 'choice',
        en: 'Backdrop',
        bg: 'Фон',
        values: [
          PANEL,
          { id: 'tint', en: 'Tint', bg: 'Лек нюанс' },
          { id: 'white', en: 'White', bg: 'Бял' },
          { id: 'none', en: 'None', bg: 'Без фон' },
        ],
      },
      {
        id: 'frame',
        kind: 'choice',
        en: 'Frame',
        bg: 'Рамка',
        values: [
          { id: 'bleed', en: 'Edge to edge', bg: 'До краищата' },
          { id: 'inset', en: 'Inset', bg: 'С отстъп' },
        ],
      },
      {
        id: 'corners',
        kind: 'choice',
        en: 'Corners',
        bg: 'Ъгли',
        values: [{ id: 'general', en: 'As in General', bg: 'Както в Общи' }, SQUARE, ROUND],
      },
    ],
  },
  {
    id: 'labels',
    en: 'Labels and allergens',
    bg: 'Етикети и алергени',
    markers: ['item.labels', 'item.marks', 'item.allergens'],
    options: [
      {
        id: 'labels',
        kind: 'choice',
        en: 'Labels',
        bg: 'Етикети',
        values: [
          { id: 'outline', en: 'Outline', bg: 'С контур' },
          { id: 'soft', en: 'Soft', bg: 'Меки' },
          { id: 'text', en: 'Text', bg: 'Текст' },
        ],
      },
      {
        id: 'allergens',
        kind: 'choice',
        en: 'Allergens',
        bg: 'Алергени',
        values: [
          { id: 'numbers', en: 'Numbers', bg: 'Номера' },
          { id: 'names', en: 'Names', bg: 'Имена' },
        ],
      },
    ],
  },
  {
    id: 'dish',
    en: 'Dish page',
    bg: 'Страница на артикула',
    markers: ['dish', 'dish.photo'],
    options: [
      {
        id: 'kind',
        kind: 'choice',
        en: 'Kind',
        bg: 'Вид',
        values: [
          { id: 'sheet', en: 'Sheet', bg: 'Панел' },
          { id: 'page', en: 'Full page', bg: 'Цяла страница' },
        ],
      },
      {
        id: 'photo',
        kind: 'choice',
        en: 'Photo',
        bg: 'Снимка',
        values: [
          { id: 'hero', en: 'Large', bg: 'Голяма' },
          { id: 'small', en: 'Small', bg: 'Малка' },
        ],
      },
    ],
  },
  {
    id: 'sheets',
    en: 'Sheets and footer',
    bg: 'Панели и долна част',
    markers: ['sheet', 'footer'],
    options: [
      {
        id: 'sheets',
        kind: 'choice',
        en: 'Sheets',
        bg: 'Панели',
        values: [PANEL, PAGE, INK],
      },
    ],
  },
  {
    id: 'call',
    en: 'Call a waiter',
    bg: 'Повикване на сервитьор',
    markers: ['call', 'call.kinds', 'status'],
    options: [
      {
        id: 'kinds',
        kind: 'choice',
        en: 'Kinds',
        bg: 'Видове',
        values: [{ id: 'tiles', en: 'Tiles', bg: 'Плочки' }, LIST],
      },
    ],
  },
  {
    id: 'bill',
    en: 'Bill',
    bg: 'Сметка',
    markers: ['bill', 'bill.lines', 'bill.total'],
    options: [
      {
        id: 'rows',
        kind: 'choice',
        en: 'Rows',
        bg: 'Разделяне на редовете',
        values: [RULED, { id: 'zebra', en: 'Alternating bands', bg: 'Редуващи се ленти' }],
      },
      {
        id: 'lines',
        kind: 'choice',
        en: 'Lines',
        bg: 'Подробност на редовете',
        values: [
          { id: 'detailed', en: 'Detailed', bg: 'Подробни' },
          { id: 'compact', en: 'Compact', bg: 'Стегнати' },
        ],
      },
    ],
  },
  {
    id: 'order',
    en: 'Order',
    bg: 'Поръчка',
    markers: ['order', 'order.bar', 'item.add'],
    options: [
      {
        id: 'add_control',
        kind: 'choice',
        en: 'Add control',
        bg: 'Бутон за добавяне',
        values: [
          { id: 'plus', en: 'Plus', bg: 'Плюс' },
          { id: 'add', en: 'Add', bg: 'Добави' },
        ],
      },
      {
        id: 'order_bar',
        kind: 'choice',
        en: 'Order bar',
        bg: 'Лента за поръчката',
        values: [
          { id: 'floating', en: 'Floating', bg: 'Плаваща' },
          { id: 'docked', en: 'Docked', bg: 'Закрепена' },
        ],
      },
      {
        id: 'line_photos',
        kind: 'choice',
        en: 'Line photos',
        bg: 'Снимки на редовете',
        values: [
          { id: 'hidden', en: 'Hidden', bg: 'Скрити' },
          { id: 'shown', en: 'Shown', bg: 'Показани' },
        ],
      },
    ],
  },
  {
    id: 'pay',
    en: 'Pay',
    bg: 'Плащане',
    markers: ['pay', 'pay.scope', 'pay.tip', 'pay.methods'],
    options: [
      {
        id: 'tip',
        kind: 'choice',
        en: 'Tip',
        bg: 'Бакшиш',
        values: [{ id: 'chips', en: 'Chips', bg: 'Малки бутони' }, ROWS],
      },
    ],
  },
  {
    id: 'receipt',
    en: 'Receipt',
    bg: 'Бележка',
    markers: ['receipt', 'receipt.venue'],
    options: [
      {
        id: 'venue_block',
        kind: 'choice',
        en: 'Venue block',
        bg: 'Данни за заведението',
        values: [
          { id: 'name', en: 'Name', bg: 'Име' },
          { id: 'logo', en: 'Logo', bg: 'Лого' },
        ],
      },
    ],
  },
] as const satisfies readonly DesignPage[]

/** One page of the contract. */
export type DesignPageEntry = (typeof DESIGN_PAGES)[number]

/** The id of a page: `general`, `header`, … */
export type DesignPageId = DesignPageEntry['id']

type ChoicesOf<P extends DesignPageEntry> = Extract<P['options'][number], { kind: 'choice' }>

/** The options a Style sets: every choice but the brand's (the body font). */
type StyleChoicesOf<P extends DesignPageEntry> = Exclude<ChoicesOf<P>, { brand: true }>

/** A design's values: for each page, each choice option's value. The Style and the colours are the record's own. */
export type DesignValues = {
  [P in DesignPageEntry as P['id']]: {
    [O in ChoicesOf<P> as O['id']]: O['values'][number]['id']
  }
}

/** What a Style file gives: a value for every option but the body font (D128), no colours or logo. */
export type StyleValues = {
  [P in DesignPageEntry as P['id']]: {
    [O in StyleChoicesOf<P> as O['id']]: O['values'][number]['id']
  }
}

/** The id of a premade Style, from the Style option's own list. */
export type PremadeStyleId = Extract<
  (typeof DESIGN_PAGES)[0]['options'][0],
  { kind: 'style' }
>['values'][number]['id']

/** The shape of a short lower-case token: how every value, option and page id is written. */
export const DESIGN_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The longest a value token may be. */
export const DESIGN_TOKEN_MAX = 20

/** The `data-design-part` marker names: lower-case words joined by dots. */
export const DESIGN_MARKER = /^[a-z]+(?:\.[a-z]+)*$/

/** Every option of every page, with the page it is on, in the contract's order. */
export const DESIGN_OPTIONS: readonly {
  readonly page: DesignPageEntry
  readonly option: DesignOption
}[] = DESIGN_PAGES.flatMap((page) => page.options.map((option) => ({ page, option })))

/** The page that owns a `data-design-part` marker, by marker name. */
export const DESIGN_MARKER_PAGES: ReadonlyMap<string, DesignPageId> = new Map(
  DESIGN_PAGES.flatMap((page) => page.markers.map((marker) => [marker, page.id] as const)),
)
