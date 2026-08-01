import { createAdminClient } from "./supabase/admin";

// Support tickets, read and written through the service role.
//
// Reads could go through the user's own client, since RLS already limits them to
// their own rows, but writes cannot: a ticket's status and the `author` field on a
// message are both things the browser must not be able to set. Sending them through
// here keeps one path, and keeps "who said this" a server decision.

export type TicketStatus = "open" | "answered" | "closed";
export type TicketTopic = "billing" | "leads" | "technical" | "account" | "other";

// The same five the database allows, in the words a customer would use. Anything
// added here needs the check constraint in migration 016 widened to match.
export const TICKET_TOPICS: { id: TicketTopic; label: string }[] = [
  { id: "leads", label: "A lead or a search" },
  { id: "billing", label: "Billing or credits" },
  { id: "technical", label: "Something is broken" },
  { id: "account", label: "My account" },
  { id: "other", label: "Something else" },
];

export type Ticket = {
  id: string;
  subject: string;
  status: TicketStatus;
  topic: TicketTopic;
  createdAt: string;
  lastMessageAt: string;
  messageCount?: number;
};

export type TicketMessage = {
  id: string;
  author: "customer" | "support";
  body: string;
  createdAt: string;
};

const MAX_OPEN_TICKETS = 10;

function toTicket(row: Record<string, unknown>): Ticket {
  return {
    id: row.id as string,
    subject: row.subject as string,
    status: row.status as TicketStatus,
    topic: row.topic as TicketTopic,
    createdAt: row.created_at as string,
    lastMessageAt: row.last_message_at as string,
  };
}

export async function listTickets(userId: string): Promise<Ticket[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_tickets")
    .select("id, subject, status, topic, created_at, last_message_at")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(50);
  return (data ?? []).map(toTicket);
}

export async function getTicket(
  userId: string,
  ticketId: string
): Promise<{ ticket: Ticket; messages: TicketMessage[] } | null> {
  const admin = createAdminClient();
  // The user_id filter is the ownership check. Without it the service role would
  // happily hand back somebody else's thread to anyone who guessed an id.
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, subject, status, topic, created_at, last_message_at")
    .eq("id", ticketId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!ticket) return null;

  const { data: messages } = await admin
    .from("support_messages")
    .select("id, author, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  return {
    ticket: toTicket(ticket),
    messages: (messages ?? []).map((m) => ({
      id: m.id as string,
      author: m.author as "customer" | "support",
      body: m.body as string,
      createdAt: m.created_at as string,
    })),
  };
}

/**
 * Open a ticket, with its first message.
 *
 * Refuses past a small number of unfinished threads. This is not a rate limit against
 * abuse so much as against confusion: eleven open tickets from one person is a
 * conversation that has gone wrong, and answering the existing ones is what helps.
 */
export async function createTicket(
  userId: string,
  input: { subject: string; topic: TicketTopic; body: string }
): Promise<{ ticket: Ticket } | { error: string }> {
  const admin = createAdminClient();

  const { count } = await admin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "closed");
  if ((count ?? 0) >= MAX_OPEN_TICKETS) {
    return {
      error: "You already have several open tickets. Reply on one of those and we will pick it up there.",
    };
  }

  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({ user_id: userId, subject: input.subject.trim(), topic: input.topic })
    .select("id, subject, status, topic, created_at, last_message_at")
    .single();
  if (error || !ticket) return { error: "Could not open that ticket. Try again." };

  const { error: msgError } = await admin.from("support_messages").insert({
    ticket_id: ticket.id,
    user_id: userId,
    author: "customer",
    body: input.body.trim(),
  });
  if (msgError) {
    // A ticket with no message in it is a thread nobody can answer. Roll it back
    // rather than leave an empty row in the queue.
    await admin.from("support_tickets").delete().eq("id", ticket.id);
    return { error: "Could not open that ticket. Try again." };
  }

  return { ticket: toTicket(ticket) };
}

/** Add a message from the customer, and put the ticket back in the queue. */
export async function replyToTicket(
  userId: string,
  ticketId: string,
  body: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!ticket) return false;

  const { error } = await admin.from("support_messages").insert({
    ticket_id: ticketId,
    user_id: userId,
    author: "customer",
    body: body.trim(),
  });
  if (error) return false;

  const now = new Date().toISOString();
  // Replying reopens it. Someone who writes again has not had their answer, whatever
  // the status said a moment ago.
  await admin
    .from("support_tickets")
    .update({ status: "open", last_message_at: now, updated_at: now })
    .eq("id", ticketId);
  return true;
}

/** The customer marking their own thread as done. */
export async function closeTicket(userId: string, ticketId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("support_tickets")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("user_id", userId);
  return !error;
}

// ---------------------------------------------------------------------------
// The operator side.
// ---------------------------------------------------------------------------

export type AdminTicket = Ticket & { email: string | null };

export async function listAllTickets(includeClosed = false): Promise<AdminTicket[]> {
  const admin = createAdminClient();
  let q = admin
    .from("support_tickets")
    .select("id, user_id, subject, status, topic, created_at, last_message_at")
    .order("last_message_at", { ascending: true })
    .limit(200);
  if (!includeClosed) q = q.neq("status", "closed");
  const { data } = await q;
  const rows = data ?? [];

  // The email lives on the auth user, not on a table we can join to. One lookup per
  // ticket is fine at this volume and avoids duplicating an address into our tables.
  const emails = new Map<string, string | null>();
  for (const r of rows) {
    const uid = r.user_id as string;
    if (emails.has(uid)) continue;
    const { data: u } = await admin.auth.admin.getUserById(uid);
    emails.set(uid, u?.user?.email ?? null);
  }

  return rows.map((r) => ({ ...toTicket(r), email: emails.get(r.user_id as string) ?? null }));
}

export async function getTicketAsAdmin(
  ticketId: string
): Promise<{ ticket: AdminTicket; messages: TicketMessage[] } | null> {
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, user_id, subject, status, topic, created_at, last_message_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return null;

  const [{ data: messages }, { data: u }] = await Promise.all([
    admin
      .from("support_messages")
      .select("id, author, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    admin.auth.admin.getUserById(ticket.user_id as string),
  ]);

  return {
    ticket: { ...toTicket(ticket), email: u?.user?.email ?? null },
    messages: (messages ?? []).map((m) => ({
      id: m.id as string,
      author: m.author as "customer" | "support",
      body: m.body as string,
      createdAt: m.created_at as string,
    })),
  };
}

/** A reply from support. Sets the ticket to answered, waiting on the customer. */
export async function answerTicket(ticketId: string, body: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("user_id")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return false;

  const { error } = await admin.from("support_messages").insert({
    ticket_id: ticketId,
    user_id: ticket.user_id as string,
    author: "support",
    body: body.trim(),
  });
  if (error) return false;

  const now = new Date().toISOString();
  await admin
    .from("support_tickets")
    .update({ status: "answered", last_message_at: now, updated_at: now })
    .eq("id", ticketId);
  return true;
}

export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("support_tickets")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", ticketId);
  return !error;
}
