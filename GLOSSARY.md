# Restro

Restro turns a venue's menu into a page guests open on their phone from a QR code. This glossary is the project's own language: one word per concept, for docs, briefs, code names and interface text.

## Organisations and venues

**Organisation**:
The business that uses Restro. It owns venues, POS instances and domains.
_Avoid_: tenant, account, company

**Venue**:
One place guests visit, with its own menus, areas, tables and guest address.
_Avoid_: location, club, restaurant, store

**Source**:
Where a venue's items come from: one POS instance, or by hand. Fixed when the venue is created.
_Avoid_: menu source (that is the POS root a menu reads from)

**POS venue**:
A venue whose items come from a POS. Restro may hide, rename, reorder, regroup and enrich them, but never creates, deletes or re-prices them.
_Avoid_: barsy venue, till venue, synced venue

**Hand-made venue**:
A venue with no POS, whose menus Restro's users build and fully control. "By hand" is the source a hand-made venue is created with.
_Avoid_: by-hand venue, Restro venue, manual venue

**Venue state**:
Draft (never published, or unpublished), Live, Archived, or Deleted.

**Archived**:
A venue an owner has removed but can still restore, for 30 days. Guests and the admin no longer see it.
_Avoid_: deleted (while it can still be restored), binned

**Deleted**:
A venue that can no longer be restored: its own data has been purged.
_Avoid_: archived, removed

**Purge**:
The permanent erasure of an archived venue's own data, which makes it Deleted: 30 days after archiving, or at once when an owner deletes it permanently.
_Avoid_: hard delete, wipe

## POS and sync

**POS**:
The venue's own point-of-sale system (barsy, Mistral), which holds the items, prices and tables the venue actually sells from.
_Avoid_: till, cash register, ERP

**POS system**:
A kind of POS that Restro can connect to, such as barsy.
_Avoid_: vendor, provider

**Instance**:
One organisation's connection to one installation of a POS system, with its own credentials, settings and sync history.
_Avoid_: integration, connection, account

**Connector**:
Restro's adapter for one POS system: it reads that system's data and translates it into Restro's model.
_Avoid_: plugin, driver

**Sync**:
Reading a POS's current data into Restro. Sync only ever reads; it never writes into a POS.
_Avoid_: import, pull (on its own)

**Full read**:
A sync that reads everything the POS holds. Only a complete full read can conclude that an item was deleted in the POS.
_Avoid_: full pull, full sync

**Layer**:
One origin of a stored value: the POS, a user's manual edit, an override, or an edition. Restro's layers can only make the menu more cautious than the POS.

## Menus

**Menu**:
A set of sections and items that a venue shows guests. A venue can have several.
_Avoid_: catalogue, card

**Live menu**:
The one menu a venue shows guests by default, unless an area or table has its own.
_Avoid_: main menu, default menu

**Section**:
A named group of items inside a menu.
_Avoid_: category (the POS's word), group

**Item**:
Something on a menu a guest can see, usually with a price.
_Avoid_: product, article, dish, drink

**Item schema**:
The set of fields an item can have, such as name, description, price, photo and allergens.
_Avoid_: template (that is the phone design)

**Placement**:
An item's membership of a section and its position there. Placements are layout, kept apart from what an item is.

**Mapper**:
Restro's own arrangement of a POS venue's sections and items over the POS's structure: order, grouping, hidden entries, own sections.

**Dictionary**:
Restro's own texts written over a POS's names.
_Avoid_: translations (for this specific overlay)

**Enrichment**:
What Restro adds to an item beyond the POS's data: texts, photos, tags, allergens.

**Tag**:
A venue-defined label on an item, such as a dietary label, shown to guests.
_Avoid_: badge, label (on its own)

**Sold out**:
An item that stays visible but greyed out with no order button, because the POS stopped selling it or a manager marked it sold out for tonight.
_Avoid_: unavailable, out of stock

**Hidden**:
An item or section guests do not see at all.

## Publishing and design

**Composer**:
The admin screen where a venue's menus are arranged (Structure) and styled (Design).
_Avoid_: editor, builder

**Publish**:
Making a menu's current draft the version guests see.

**Version**:
One published state of a menu. A venue keeps the live version and up to two restorable ones.

**Template**:
A guest phone design a venue picks in the Design tab, such as Editorial Market.
_Avoid_: face (the template's code), theme, skin; never for the item schema

**Guest page**:
The page a guest opens on their phone: one venue's menu in that venue's template.
_Avoid_: guest menu, public page, shell (the host code around a template)

**Guest feature**:
A service a venue can switch on for guests, such as the bag, the bill or calling a waiter. Guests see it only once Restro supports it.
_Avoid_: guest function, service screen

## Tables and addresses

**Area**:
A part of a venue with its own tables, such as a hall or a terrace.
_Avoid_: hall, salon, zone, room

**Table**:
A place in an area where guests sit and scan a table code.

**Table code**:
The QR code on a table; it opens the menu routed to that table.
_Avoid_: QR token, QR link, sticker

**Menu routing**:
The rule that picks which menu a table code opens: the table's own menu, else its area's, else the venue's live menu.

**Guest address**:
A venue's public web address, on Restro's domain or on the organisation's own domain.
_Avoid_: URL, link, slug

**Service day**:
A venue's business day, which ends at 07:00 local time by default, not at midnight.
_Avoid_: day, night, shift
