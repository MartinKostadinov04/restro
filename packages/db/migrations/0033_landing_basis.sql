-- Late landing of an Unconfirmed sent order (#135): what the match needs of the reading before the write.
ALTER TABLE "restro"."sent_orders" ADD COLUMN "landing_basis" jsonb;
