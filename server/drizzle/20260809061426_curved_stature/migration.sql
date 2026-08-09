CREATE TABLE `checkins` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`date` text NOT NULL,
	`checked_in_at` integer DEFAULT (unixepoch()) NOT NULL,
	`checked_in_by` text,
	`payment_id` integer,
	`undone_at` integer,
	CONSTRAINT `fk_checkins_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE TABLE `givebutter_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`givebutter_contact_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_givebutter_contacts_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`givebutter_plan_id` text NOT NULL,
	`status` text NOT NULL,
	`frequency` text,
	`amount_cents` integer,
	`current_period_end` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_memberships_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`givebutter_transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_at` integer NOT NULL,
	`redeemed_at` integer,
	`redeemed_by_checkin_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_payments_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`source` text PRIMARY KEY,
	`last_synced_at` integer,
	`cursor` text
);
--> statement-breakpoint
CREATE TABLE `waivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`form_response_id` text NOT NULL,
	`signed_at` integer NOT NULL,
	`raw_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_waivers_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `givebutter_contacts_contact_idx` ON `givebutter_contacts` (`givebutter_contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_plan_idx` ON `memberships` (`givebutter_plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_transaction_idx` ON `payments` (`givebutter_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_email_idx` ON `students` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `waivers_form_response_idx` ON `waivers` (`form_response_id`);