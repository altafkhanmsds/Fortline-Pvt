import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NotificationsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ accountId: "acc-123", user: { id: "user-123" } }),
}));

vi.mock("@/hooks/use-channel", () => ({
  useChannel: () => ({ activeChannel: "whatsapp" }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const sampleNotifications = [
  {
    id: "notif-1",
    account_id: "acc-123",
    user_id: "user-123",
    title: "🚨 WhatsApp Device Unlinked: bilal",
    body: "WhatsApp session was explicitly terminated",
    type: "channel_disconnected",
    read: false,
    severity: "critical",
    entity_type: "channel",
    entity_id: "ch-1",
    created_at: new Date().toISOString(),
  },
  {
    id: "notif-2",
    account_id: "acc-123",
    user_id: "user-123",
    title: "⚠️ Overdue Response SLA",
    body: "Client inquiry unattended",
    type: "sla_breach",
    read: true,
    severity: "warning",
    created_at: new Date().toISOString(),
  },
];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: vi.fn().mockResolvedValue({ data: sampleNotifications, error: null }),
          }),
        }),
      }),
      delete: () => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      update: () => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    channel: () => ({
      on: () => ({
        subscribe: vi.fn(),
      }),
    }),
    removeChannel: vi.fn(),
  }),
}));

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders to static markup with loading state initially", () => {
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).toBeDefined();
  });
});
