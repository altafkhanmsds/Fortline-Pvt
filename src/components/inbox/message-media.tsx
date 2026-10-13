"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  ImageOff,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import { downloadMediaMessage } from "@/lib/media/download";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import { getMediaThumbnailUrl, resolveDisplayMediaUrl } from "@/lib/media/blob-cache";

type Translator = ReturnType<typeof useTranslations>;

/** Inline media size cap, shared so bubbles stay responsive and never overflow. */
const MEDIA_BOX = "max-h-80 w-full max-w-[260px] sm:max-w-[320px]";

export function MediaUnavailable({
  label,
  onRetry,
}: {
  label: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex w-[240px] sm:w-[280px] max-w-full items-center justify-between gap-2.5 rounded-xl bg-black/20 dark:bg-black/40 px-3.5 py-3 text-xs text-muted-foreground border border-border/40">
      <div className="flex items-center gap-2 min-w-0">
        <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <span className="truncate font-medium">{label} unavailable</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md bg-white/10 dark:bg-white/15 hover:bg-white/20 px-2 py-1 text-[11px] font-medium text-foreground transition-colors shrink-0"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Kicks off a download and reports failure as a toast.
 */
function useMediaDownload(message: Message, t: Translator) {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [downloading, message, t]);

  return { downloading, download };
}

function MediaActionButton({
  icon: Icon,
  label,
  onClick,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ============================================================================
// 1. IMAGE MESSAGES
// ============================================================================

export function MediaImageBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  /** Opens the thread's lightbox on this message. */
  onOpen?: () => void;
  t: Translator;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const baseDisplayUrl = resolveDisplayMediaUrl(message);
  const displayUrl = useMemo(() => {
    if (!baseDisplayUrl) return undefined;
    if (retryKey === 0) return baseDisplayUrl;
    const sep = baseDisplayUrl.includes("?") ? "&" : "?";
    return `${baseDisplayUrl}${sep}_r=${retryKey}`;
  }, [baseDisplayUrl, retryKey]);

  const { src, status } = useMediaBlobUrl(displayUrl);
  const [broken, setBroken] = useState(false);
  const { downloading, download } = useMediaDownload(message, t);
  const posterThumb = getMediaThumbnailUrl(message);

  const handleRetry = useCallback(() => {
    setBroken(false);
    setRetryKey((k) => k + 1);
  }, []);

  if (!displayUrl || status === "error" || broken) {
    return (
      <MediaUnavailable
        label="Full image"
        onRetry={handleRetry}
      />
    );
  }

  if (status !== "ready" || !src) {
    return (
      <div className="relative flex h-52 w-[240px] sm:w-[280px] max-w-full items-center justify-center rounded-xl bg-black/20 dark:bg-black/40 overflow-hidden border border-border/30">
        {posterThumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posterThumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover blur-md opacity-30"
          />
        )}
        <div className="flex flex-col items-center gap-2 text-center z-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-[11px] text-muted-foreground/80 font-medium">Loading full image…</span>
        </div>
      </div>
    );
  }

  const imageElement = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={message.content_text || t("imageAlt")}
      className="block h-auto max-h-[380px] min-h-[120px] w-auto max-w-full rounded-xl object-contain transition-transform duration-150 active:scale-[0.99]"
      onError={() => setBroken(true)}
    />
  );

  return (
    <div className="group/media relative w-fit max-w-[260px] sm:max-w-[320px] overflow-hidden rounded-xl bg-black/10 dark:bg-black/20 border border-border/30">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t("viewImage")}
          className="block cursor-zoom-in rounded-xl outline-none ring-offset-2 ring-offset-transparent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {imageElement}
        </button>
      ) : (
        imageElement
      )}

      {/* Hover download button */}
      <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover/media:opacity-100 group-focus-within/media:opacity-100">
        <MediaActionButton
          icon={Download}
          label={t("download")}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

// ============================================================================
// 2. VIDEO MESSAGES
// ============================================================================

export function MediaVideoBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  onOpen?: () => void;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);
  const [retryKey, setRetryKey] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const baseDisplayUrl = resolveDisplayMediaUrl(message);
  const videoUrl = useMemo(() => {
    if (!baseDisplayUrl) return undefined;
    if (retryKey === 0) return baseDisplayUrl;
    const sep = baseDisplayUrl.includes("?") ? "&" : "?";
    return `${baseDisplayUrl}${sep}_r=${retryKey}`;
  }, [baseDisplayUrl, retryKey]);

  const posterThumb = getMediaThumbnailUrl(message);

  const handleRetry = useCallback(() => {
    setLoadError(false);
    setRetryKey((k) => k + 1);
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, []);

  if (!videoUrl || loadError) {
    return (
      <MediaUnavailable
        label="Video"
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="relative w-full max-w-[260px] sm:max-w-[320px] overflow-hidden rounded-xl bg-black border border-border/40">
      <video
        ref={videoRef}
        key={videoUrl}
        src={videoUrl}
        poster={posterThumb}
        controls
        playsInline
        autoPlay={false}
        preload="metadata"
        onError={() => setLoadError(true)}
        className={cn(MEDIA_BOX, "block rounded-xl object-contain bg-black")}
      />

      {/* Floating action buttons in top-right */}
      <div className="absolute right-2 top-2 flex gap-1 z-10 pointer-events-auto">
        {onOpen && (
          <MediaActionButton
            icon={Maximize2}
            label={t("expandVideo")}
            onClick={onOpen}
          />
        )}
        <MediaActionButton
          icon={Download}
          label={t("download")}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

// ============================================================================
// 3. VOICE NOTES / AUDIO
// ============================================================================

export function MediaAudioBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);
  const [retryKey, setRetryKey] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const baseDisplayUrl = resolveDisplayMediaUrl(message);
  const audioUrl = useMemo(() => {
    if (!baseDisplayUrl) return undefined;
    if (retryKey === 0) return baseDisplayUrl;
    const sep = baseDisplayUrl.includes("?") ? "&" : "?";
    return `${baseDisplayUrl}${sep}_r=${retryKey}`;
  }, [baseDisplayUrl, retryKey]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const handleRetry = useCallback(() => {
    setLoadError(false);
    setRetryKey((k) => k + 1);
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => setLoadError(true));
    }
  }, [playing]);

  const toggleMute = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !muted;
    setMuted(!muted);
  }, [muted]);

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (el) setCurrentTime(el.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (el && Number.isFinite(el.duration)) {
      setDuration(el.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setCurrentTime(0);
    const el = audioRef.current;
    if (el) el.currentTime = 0;
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const val = parseFloat(e.target.value);
    el.currentTime = val;
    setCurrentTime(val);
  }, []);

  const fmtTime = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "00:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  if (!audioUrl || loadError) {
    return (
      <MediaUnavailable
        label="Audio"
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="flex w-full min-w-[230px] max-w-[280px] sm:max-w-[320px] items-center gap-2.5 py-1.5 px-1">
      {/* Hidden audio element with streaming support */}
      <audio
        ref={audioRef}
        key={audioUrl}
        src={audioUrl}
        preload="metadata"
        autoPlay={false}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={() => setLoadError(true)}
      />

      {/* WhatsApp green circular Play / Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        {playing ? (
          <Pause className="h-4 w-4 fill-white" />
        ) : (
          <Play className="h-4 w-4 fill-white ml-0.5" />
        )}
      </button>

      {/* Clean progress bar and duration (no fake waveform) */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="relative flex h-5 items-center">
          {/* Progress track */}
          <div className="h-1.5 w-full rounded-full bg-muted-foreground/25 overflow-hidden">
            <div
              className="h-full bg-[#00a884] transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {/* Native seek input */}
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Seek audio"
          />
        </div>

        {/* Timestamps */}
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground/80 px-0.5">
          <span>{fmtTime(currentTime)}</span>
          <span>{duration > 0 ? fmtTime(duration) : fmtTime(0)}</span>
        </div>
      </div>

      {/* Volume mute toggle */}
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
        className="text-muted-foreground/70 hover:text-foreground transition-colors p-1"
      >
        {muted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>

      {/* Download action */}
      <MediaActionButton
        icon={Download}
        label={t("download")}
        onClick={download}
        busy={downloading}
      />
    </div>
  );
}

// ============================================================================
// 4. DOCUMENTS / FILES
// ============================================================================

function formatFileSize(bytes?: number | string | null): string | null {
  if (!bytes) return null;
  const num = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveDocumentDetails(message: Message) {
  const rawMsg = (message as any)?.metadata?.rawMessage || (message as any)?.metadata?.message;
  const docMsg = rawMsg?.documentMessage;

  let fileName = docMsg?.fileName || (message as any)?.metadata?.fileName;
  if (!fileName && message.content_text) {
    const match = message.content_text.match(/^\[Document:\s*(.+?)\]$/i);
    if (match) {
      fileName = match[1];
    } else if (!message.content_text.startsWith("[") && message.content_text.includes(".")) {
      fileName = message.content_text.trim();
    }
  }
  if (!fileName) fileName = "Document";

  const mime = docMsg?.mimetype || (message as any)?.media_mime_type || "";
  const sizeFormatted = formatFileSize(docMsg?.fileLength || (message as any)?.metadata?.fileLength);

  let typeLabel = "Document";
  let IconComponent = FileText;
  let iconColor = "text-muted-foreground";

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf") || mime.includes("pdf")) {
    typeLabel = "PDF Document";
    IconComponent = FileText;
    iconColor = "text-red-500";
  } else if (
    lowerName.endsWith(".doc") ||
    lowerName.endsWith(".docx") ||
    mime.includes("word")
  ) {
    typeLabel = "Word Document";
    IconComponent = FileText;
    iconColor = "text-blue-500";
  } else if (
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".csv") ||
    mime.includes("sheet") ||
    mime.includes("excel")
  ) {
    typeLabel = "Spreadsheet";
    IconComponent = FileSpreadsheet;
    iconColor = "text-emerald-500";
  } else if (
    lowerName.endsWith(".zip") ||
    lowerName.endsWith(".rar") ||
    lowerName.endsWith(".7z") ||
    mime.includes("zip")
  ) {
    typeLabel = "Archive";
    IconComponent = FileArchive;
    iconColor = "text-amber-500";
  }

  return {
    fileName,
    typeLabel,
    sizeFormatted,
    IconComponent,
    iconColor,
  };
}

export function MediaDocumentBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);
  const displayUrl = resolveDisplayMediaUrl(message);

  const { fileName, typeLabel, sizeFormatted, IconComponent, iconColor } =
    useMemo(() => resolveDocumentDetails(message), [message]);

  if (!displayUrl) {
    return <MediaUnavailable label="Document" />;
  }

  return (
    <div className="flex w-full min-w-[240px] max-w-[280px] sm:max-w-[320px] flex-col gap-2 rounded-xl bg-black/15 dark:bg-black/30 p-2.5 border border-border/40">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/80 shadow-sm border border-border/40">
          <IconComponent className={cn("h-5 w-5", iconColor)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-xs font-semibold text-foreground"
            title={fileName}
          >
            {fileName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {typeLabel}
            {sizeFormatted ? ` • ${sizeFormatted}` : ""}
          </span>
        </div>
      </div>

      {/* Action buttons: Open in browser and Download */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
        <a
          href={displayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-background/70 hover:bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors border border-border/40 shadow-sm"
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Open</span>
        </a>
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/70 hover:bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors border border-border/40 shadow-sm disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}
