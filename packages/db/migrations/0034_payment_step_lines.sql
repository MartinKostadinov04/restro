-- After "No receipt" (#153): the lines read on the payment table before a move back, so a later run can prove them back.
ALTER TABLE "restro"."payment_steps" ADD COLUMN "lines" jsonb;
