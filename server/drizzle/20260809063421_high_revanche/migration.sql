CREATE TABLE `student_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`student_id` integer NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_student_emails_student_id_students_id_fk` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_emails_email_idx` ON `student_emails` (`email`);