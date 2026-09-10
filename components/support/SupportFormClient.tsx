"use client";

import { useState } from "react";
import {
  submitSupportTicket,
  SUPPORT_CATEGORY_LABELS,
  SUBMIT_SUPPORT_TICKET_ERROR_MESSAGES,
  type SupportCategory,
} from "@/lib/support/submit-support-ticket";

const CATEGORIES = Object.keys(SUPPORT_CATEGORY_LABELS) as SupportCategory[];
const MESSAGE_MAX_LENGTH = 2000;

/**
 * The logged-in submission path for PRD 43.1 ("Support form requires
 * login... Categories may include: General inquiry, Account issue,
 * Order/dispute issue, Report a problem"). This does not send an email
 * (out of scope for this task) and does not perform account deletion --
 * a user can describe a deletion/anonymization request under "Account
 * issue" for an admin to action manually later; no automatic action is
 * taken here.
 */
export function SupportFormClient() {
  const [category, setCategory] = useState<SupportCategory | "">("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const trimmedLength = message.trim().length;
  const messageTooLong = message.length > MESSAGE_MAX_LENGTH;
  const canSubmit = category !== "" && trimmedLength > 0 && !messageTooLong && !isSubmitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setSubmitError(null);
    const result = await submitSupportTicket(category, message.trim());
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(SUBMIT_SUPPORT_TICKET_ERROR_MESSAGES[result.code]);
      return;
    }

    setSubmitted(true);
    setCategory("");
    setMessage("");
  }

  if (submitted) {
    return (
      <div className="rounded-[10px] border border-border bg-canvas p-4 text-sm text-ink" role="status">
        <p className="font-semibold">Request submitted</p>
        <p className="mt-1 text-ink-secondary">Thanks -- our team will review your request. You can send another one below if needed.</p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="mt-3 rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="support-category" className="text-sm font-medium text-ink">
          Category
        </label>
        <select
          id="support-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as SupportCategory)}
          className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <option value="">Choose a category</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {SUPPORT_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="support-message" className="text-sm font-medium text-ink">
          How can we help?
        </label>
        <textarea
          id="support-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          maxLength={MESSAGE_MAX_LENGTH + 200}
          aria-invalid={messageTooLong}
          className="mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          placeholder="Describe your question or issue. Include an order number if this is about a specific order."
        />
        <p className={`mt-1 text-xs ${messageTooLong ? "text-danger" : "text-ink-muted"}`}>
          {messageTooLong ? `Please shorten your message to ${MESSAGE_MAX_LENGTH} characters or fewer.` : `${message.length}/${MESSAGE_MAX_LENGTH}`}
        </p>
      </div>

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="h-11 w-full rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
      >
        {isSubmitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
