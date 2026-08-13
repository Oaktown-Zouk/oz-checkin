CREATE TABLE `promo_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`reason` text NOT NULL,
	`granted_at` integer NOT NULL,
	`redeemed_at` integer,
	`redeemed_by_checkin_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_promo_credits_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
ALTER TABLE `checkins` ADD `promo_credit_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `promo_credits_student_reason_idx` ON `promo_credits` (`student_id`,`reason`);