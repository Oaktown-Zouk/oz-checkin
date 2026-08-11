CREATE TABLE `membership_charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`givebutter_plan_id` text NOT NULL,
	`givebutter_transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_membership_charges_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_charges_transaction_idx` ON `membership_charges` (`givebutter_transaction_id`);