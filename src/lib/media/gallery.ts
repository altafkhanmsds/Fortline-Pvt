import type { Message } from "@/types";
import { getMediaThumbnailUrl, resolveDisplayMediaUrl } from "./blob-cache";

/**
 * The set of media in a thread that the lightbox can page through, built
 * from the messages the thread already holds (no extra fetch).
 *
 * Only images and videos qualify: an audio bubble has nothing to look at,
 * and a document is handed to the OS rather than rendered. Rows with no
 * `media_url` are skipped — that's either media Meta refused to verify
 * (`verifyAndBuildUrl` returns null in the webhook) or media whose bytes
 * Meta has since expired, and both render as "unavailable" in the bubble.
 */

export type MediaGalleryKind = "image" | "video";

export interface MediaGalleryItem {
  /** `messages.id` — the lightbox's identity for "which one is open". */
  messageId: string;
  /** Full-resolution media proxy URL (/api/gateway/media/[messageId]) */
  fullSrc: string;
  /** Optional low-resolution jpegThumbnail placeholder/poster */
  thumbnailSrc?: string;
  /** Backward-compatible alias for fullSrc */
  url: string;
  kind: MediaGalleryKind;
  /** Caption, when the sender attached one. */
  caption?: string;
  createdAt: string;
  /** Drives the "You" vs contact-name label in the viewer header. */
  fromCustomer: boolean;
  /** The row itself, so a download can derive its filename. */
  message: Message;
}

function galleryKind(message: Message): MediaGalleryKind | null {
  const type = message.content_type || (message as any).media_type;
  if (type === "image") return "image";
  if (type === "video") return "video";
  return null;
}

/**
 * Viewable media in thread order. Order matters — it's what ← / → walk,
 * and the thread hands messages over already sorted by `created_at`.
 */
export function collectMediaGallery(messages: Message[]): MediaGalleryItem[] {
  const items: MediaGalleryItem[] = [];
  for (const message of messages) {
    const kind = galleryKind(message);
    if (!kind) continue;
    const fullSrc = resolveDisplayMediaUrl(message);
    if (!fullSrc) continue;

    const thumbnailSrc = getMediaThumbnailUrl(message);

    const rawMsg = (message as any).metadata?.rawMessage || (message as any).metadata?.message;
    const rawCaption =
      message.content_text ||
      (message as any).content ||
      rawMsg?.imageMessage?.caption ||
      rawMsg?.videoMessage?.caption;
    const caption =
      rawCaption &&
      !["[image]", "[photo]", "[video]", "image", "photo", "video"].includes(
        rawCaption.trim().toLowerCase()
      )
        ? rawCaption
        : undefined;

    items.push({
      messageId: message.id,
      fullSrc,
      thumbnailSrc,
      url: fullSrc,
      kind,
      caption,
      createdAt: message.created_at,
      fromCustomer: message.sender_type === "customer",
      message,
    });
  }
  return items;
}

/** Index of a message in the gallery, or -1 when it isn't in it. */
export function galleryIndexOf(
  items: MediaGalleryItem[],
  messageId: string | null,
): number {
  if (!messageId) return -1;
  return items.findIndex((item) => item.messageId === messageId);
}
