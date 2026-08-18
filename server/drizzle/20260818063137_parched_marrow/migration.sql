DROP INDEX IF EXISTS `student_emails_email_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `waivers_form_response_idx`;--> statement-breakpoint
DROP TABLE `student_emails`;--> statement-breakpoint
DROP TABLE `waivers`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN `name_source`;