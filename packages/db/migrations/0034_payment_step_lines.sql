-- After "No receipt" (#153): the lines read on the payment table before a move back, so a later run can prove them back.
ALTER TABLE "restro"."payment_steps" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "restro"."payment_steps" ADD CONSTRAINT "payment_steps_lines" CHECK ("restro"."payment_steps"."lines" is null or ("restro"."payment_steps"."step" = 'undoIsolate' and "restro"."payment_steps"."outcome" = 'attempting'
        and case when jsonb_typeof("restro"."payment_steps"."lines") = 'array'
          then jsonb_array_length("restro"."payment_steps"."lines") between 1 and 500
            and not jsonb_path_exists("restro"."payment_steps"."lines", '$[*] ? (@.type() != "object" || !exists(@.pos) || !exists(@.quantity) || !exists(@.amountMinor) || @.pos.type() != "string" || !(@.pos like_regex "^.{1,200}$") || @.quantity.type() != "string" || !(@.quantity like_regex "^-?(0|[1-9][0-9]{0,14})([.][0-9]{1,6})?$") || @.amountMinor.type() != "number" || @.amountMinor.floor() != @.amountMinor)')
          else false end));