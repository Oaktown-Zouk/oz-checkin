import { google, forms_v1 } from "googleapis";
import { eq } from "drizzle-orm";
import { config, googleFormsConfigured } from "../config.js";
import { db } from "../db/client.js";
import { syncState, waivers } from "../db/schema.js";
import { upsertStudent } from "../lib/upsertStudent.js";

const SOURCE = "google_forms";

function getFormsClient() {
  const auth = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: config.GOOGLE_REFRESH_TOKEN });
  return google.forms({ version: "v1", auth });
}

let cachedQuestionIds: { emailQuestionId?: string; nameQuestionId: string } | null = null;

// The Forms API keys answers by opaque questionId, not by the question's display title,
// so we resolve which question is "name" once (by title match) and cache it. Email is
// usually NOT a question at all: most forms use Google's built-in respondent-email
// collection (Form.settings.emailCollectionType), which puts the address on
// response.respondentEmail directly rather than in `answers`. Verified against the real
// OZ waiver form — it has no "email" question; emailCollectionType is RESPONDER_INPUT.
// We still fall back to a titled "email" question for forms that don't use that setting.
// Override with GOOGLE_FORMS_EMAIL_QUESTION_ID / GOOGLE_FORMS_NAME_QUESTION_ID if the
// auto-detection picks the wrong question.
async function resolveQuestionIds(forms: forms_v1.Forms) {
  if (config.GOOGLE_FORMS_NAME_QUESTION_ID) {
    return {
      emailQuestionId: config.GOOGLE_FORMS_EMAIL_QUESTION_ID,
      nameQuestionId: config.GOOGLE_FORMS_NAME_QUESTION_ID,
    };
  }
  if (cachedQuestionIds) return cachedQuestionIds;

  const form = await forms.forms.get({ formId: config.GOOGLE_FORM_ID! });
  const items = form.data.items ?? [];

  let emailQuestionId: string | undefined = config.GOOGLE_FORMS_EMAIL_QUESTION_ID;
  let nameQuestionId: string | undefined;

  for (const item of items) {
    const questionId = item.questionItem?.question?.questionId;
    const title = item.title?.toLowerCase();
    if (!questionId || !title) continue;
    if (!emailQuestionId && title.includes("email")) emailQuestionId = questionId;
    if (!nameQuestionId && title.includes("name")) nameQuestionId = questionId;
  }

  if (!nameQuestionId) {
    throw new Error(
      "Couldn't auto-detect the waiver form's \"name\" question by title. Set " +
        "GOOGLE_FORMS_NAME_QUESTION_ID explicitly in .env."
    );
  }

  cachedQuestionIds = { emailQuestionId, nameQuestionId };
  return cachedQuestionIds;
}

function extractAnswer(response: forms_v1.Schema$FormResponse, questionId: string): string | undefined {
  return response.answers?.[questionId]?.textAnswers?.answers?.[0]?.value ?? undefined;
}

export interface SyncResult {
  skipped: boolean;
  processed?: number;
  skippedRows?: number;
}

export async function syncGoogleForms(): Promise<SyncResult> {
  if (!googleFormsConfigured) return { skipped: true };

  const forms = getFormsClient();
  const { emailQuestionId, nameQuestionId } = await resolveQuestionIds(forms);

  const [state] = await db.select().from(syncState).where(eq(syncState.source, SOURCE));
  const filter = state?.cursor ? `timestamp > ${state.cursor}` : undefined;

  const responses: forms_v1.Schema$FormResponse[] = [];
  let pageToken: string | undefined;
  do {
    const res = await forms.forms.responses.list({
      formId: config.GOOGLE_FORM_ID!,
      filter,
      pageToken,
    });
    responses.push(...(res.data.responses ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  let processed = 0;
  let skippedRows = 0;
  let latestTimestamp = state?.cursor ?? undefined;

  for (const response of responses) {
    // Prefer Google's built-in respondent email over a form question — see the note
    // on resolveQuestionIds above.
    const email = response.respondentEmail ?? (emailQuestionId ? extractAnswer(response, emailQuestionId) : undefined);
    const name = extractAnswer(response, nameQuestionId);
    if (!email || !response.responseId || !response.lastSubmittedTime) {
      skippedRows++;
      continue;
    }

    const studentId = await upsertStudent(email, name ?? email);

    const existing = await db
      .select()
      .from(waivers)
      .where(eq(waivers.formResponseId, response.responseId));

    if (existing.length === 0) {
      await db.insert(waivers).values({
        studentId,
        formResponseId: response.responseId,
        signedAt: new Date(response.lastSubmittedTime),
        rawJson: JSON.stringify(response),
      });
    }

    processed++;
    if (!latestTimestamp || response.lastSubmittedTime > latestTimestamp) {
      latestTimestamp = response.lastSubmittedTime;
    }
  }

  await db
    .insert(syncState)
    .values({ source: SOURCE, lastSyncedAt: new Date(), cursor: latestTimestamp ?? null })
    .onConflictDoUpdate({
      target: syncState.source,
      set: { lastSyncedAt: new Date(), cursor: latestTimestamp ?? null },
    });

  return { skipped: false, processed, skippedRows };
}
