"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useChannel } from "@/hooks/use-channel";
import type { Notification } from "@/types";
import {
  Bell,
  CheckCheck,
  Check,
  Trash2,
  Loader2,
  UserPlus,
  AlertTriangle,
  AlertOctagon,
  Radio,
  Clock,
  ShieldAlert,
  Flame,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_ICON: Record<string, typeof Bell> = {
  conversation_assigned: UserPlus,
  new_unassigned_lead: UserPlus,
  unanswered_conversation: Flame,
  sla_breach: AlertOctagon,
  overdue_conversation: Clock,
  channel_disconnected: Radio,
  channel_warning: Radio,
  webhook_failure: AlertTriangle,
  delivery_failure: AlertTriangle,
  channel_error: Radio,
  system_exception: ShieldAlert,
  ceo_confirmation: ShieldAlert,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const { activeChannel } = useChannel();
  const isEmail = activeChannel === "email";
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isUnread = useCallback((n: Notification) => {
    return n.read !== true && !n.read_at;
  }, []);

  const unreadIds = notifications?.filter(isUnread).map((n) => n.id) ?? [];

  // Individual Delete
  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setNotifications((prev) => prev?.filter((n) => n.id !== id) ?? prev);
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (delErr) {
        toast.error("Failed to delete notification");
        load();
      } else {
        toast.success("Notification deleted");
      }
    },
    [load],
  );

  // Individual Mark Read & Delete
  const handleMarkRead = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setNotifications((prev) => prev?.filter((n) => n.id !== id) ?? prev);
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (delErr) {
        toast.error("Failed to clear notification");
        load();
      } else {
        toast.success("Notification marked as read and removed");
      }
    },
    [load],
  );

  // Click row to read, dismiss, and navigate
  const handleClick = useCallback(
    async (n: Notification) => {
      // Mark read and delete upon reading
      setNotifications((prev) => prev?.filter((item) => item.id !== n.id) ?? prev);
      const supabase = createClient();
      await supabase.from("notifications").delete().eq("id", n.id);

      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      } else if (n.entity_type === "channel") {
        router.push("/settings?tab=sales-members");
      } else {
        toast.success("Alert read and cleared");
      }
    },
    [router],
  );

  // Mark all unread as read & delete them
  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    setNotifications((prev) => prev?.filter((n) => !unreadIds.includes(n.id)) ?? prev);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("notifications")
      .delete()
      .in("id", unreadIds);
    setMarkingAll(false);
    if (delErr) {
      toast.error("Failed to clear notifications");
      load();
    } else {
      toast.success("All unread alerts marked as read and cleared");
    }
  }, [unreadIds, load]);

  // Bulk Delete all notifications
  const deleteAll = useCallback(async () => {
    if (!notifications || notifications.length === 0) return;
    const allIds = notifications.map((n) => n.id);
    setDeletingAll(true);
    setNotifications([]);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("notifications")
      .delete()
      .in("id", allIds);
    setDeletingAll(false);
    if (delErr) {
      toast.error("Failed to delete notifications");
      load();
    } else {
      toast.success("All notifications deleted");
    }
  }, [notifications, load]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2
          className={cn(
            "h-6 w-6 animate-spin",
            isEmail ? "text-[#2B60DE]" : "text-primary",
          )}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Executive Alerts & Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isEmail
              ? "CEO monitoring alerts for SLA breaches, unanswered client inquiries, and Microsoft 365 Exchange connectivity."
              : "CEO monitoring alerts for SLA breaches, unanswered client inquiries, and WhatsApp channel connectivity."}
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {unreadIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={markingAll || deletingAll}
              onClick={markAllRead}
              className="gap-1.5"
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4" />
              )}
              Mark all as read
            </Button>
          )}

          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={markingAll || deletingAll}
              onClick={deleteAll}
              className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40 transition-colors"
            >
              {deletingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete all
            </Button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl shadow-xs",
              isEmail
                ? "bg-[#2B60DE]/10 text-[#2B60DE]"
                : "bg-primary/10 text-primary",
            )}
          >
            <Bell className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">
            No notifications
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm text-center">
            All caught up. Operational alerts, SLA breaches, and WhatsApp connection notices will appear here in real time.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const unread = isUnread(n);
            const severity =
              (n as any).severity ||
              (n.type.includes("breach") || n.type.includes("disconnect")
                ? "critical"
                : "warning");

            return (
              <li key={n.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick(n);
                    }
                  }}
                  className={cn(
                    "group flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer",
                    unread
                      ? isEmail
                        ? "border-[#2B60DE]/30 bg-[#2B60DE]/5 hover:border-[#2B60DE]/50 hover:bg-[#2B60DE]/10 shadow-[0_0_12px_rgba(43,96,222,0.06)]"
                        : "border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10 shadow-[0_0_12px_rgba(16,185,129,0.06)]"
                      : "border-border bg-card hover:border-border/70 hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={cn(
                        "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                        severity === "critical"
                          ? "bg-rose-500/15 text-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
                          : unread
                            ? isEmail
                              ? "bg-[#2B60DE]/15 text-[#2B60DE]"
                              : "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "truncate text-sm font-semibold tracking-tight",
                            unread ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {n.title}
                        </span>
                        {severity === "critical" && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                            Critical
                          </span>
                        )}
                        {unread && (
                          <span
                            aria-label="Unread"
                            className={cn(
                              "h-2 w-2 flex-shrink-0 rounded-full",
                              isEmail ? "bg-[#2B60DE]" : "bg-primary",
                            )}
                          />
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Actions: Mark read / Delete */}
                  <div
                    className="flex items-center gap-1 shrink-0 ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {unread && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/15 rounded-lg transition-colors"
                        title="Mark as read & remove"
                        onClick={(e) => handleMarkRead(e, n.id)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/15 rounded-lg transition-colors"
                      title="Delete alert"
                      onClick={(e) => handleDelete(e, n.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
