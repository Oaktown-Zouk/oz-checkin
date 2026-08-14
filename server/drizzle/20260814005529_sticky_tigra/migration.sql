ALTER TABLE `membership_charges` ADD `holder_student_id` integer REFERENCES students(id);--> statement-breakpoint
ALTER TABLE `memberships` ADD `holder_student_id` integer REFERENCES students(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `holder_student_id` integer REFERENCES students(id);--> statement-breakpoint
-- Backfill: existing rows predate the holder/payer split, so holder starts equal to the
-- raw Givebutter-attributed student — identical to what a fresh sync would have set.
UPDATE `membership_charges` SET `holder_student_id` = `student_id` WHERE `holder_student_id` IS NULL;--> statement-breakpoint
UPDATE `memberships` SET `holder_student_id` = `student_id` WHERE `holder_student_id` IS NULL;--> statement-breakpoint
UPDATE `payments` SET `holder_student_id` = `student_id` WHERE `holder_student_id` IS NULL;