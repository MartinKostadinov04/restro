-- A sitting can end because staff moved the party to another table (P22, ticket #420): the phone
-- at the old table says where the bill stayed. Only the end-reason check widens; no row changes.
ALTER TABLE "restro"."sittings" DROP CONSTRAINT "sittings_end_reason";--> statement-breakpoint
ALTER TABLE "restro"."sittings" ADD CONSTRAINT "sittings_end_reason" CHECK ("restro"."sittings"."end_reason" is null or "restro"."sittings"."end_reason" in ('bill_closed', 'staff_closed', 'new_guests', 'closing_hour', 'code_reissued', 'party_moved'));
