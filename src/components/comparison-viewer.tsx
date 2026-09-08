"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatDuration, formatFps, formatResolution } from "@/lib/format";
import { withDownloadParam } from "@/lib/url";
import type { PublicJob } from "@/lib/types";

type ViewMode = "split" | "side-by-side" | "toggle";

type Props = {
  job: PublicJob;
  onContinue?: () => void;
};

export function ComparisonViewer({ job, onContinue }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLVideoElement>(null);
  const outputRef = useRef<HTMLVideoElement>(null);

  const [mode, setMode] = useState<ViewMode>("split");
  const [split, setSplit] = useState<number>(50);
  const [toggleSide, setToggleSide] = useState<"source" | "output">("output");
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(() => {
    return job.outputMeta?.durationSec ?? job.sourceMeta?.durationSec ?? 0;
  });
  const [muted, setMuted] = useState<boolean>(true);
  const [loop, setLoop] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const out = job.outputMeta;
  const src = job.sourceMeta;

  const updateSplitFromPointer = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const nextPercent = Math.round((clampedX / rect.width) * 1000) / 10;
    setSplit(nextPercent);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "split") return;
    // Only respond to main button
    if (event.button !== 0) return;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplitFromPointer(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging || mode !== "split") return;
    updateSplitFromPointer(event.clientX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore pointer capture errors
    }
  };

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "split") return;
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setSplit((prev) => Math.max(0, Math.round((prev - step) * 10) / 10));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setSplit((prev) => Math.min(100, Math.round((prev + step) * 10) / 10));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSplit(100);
    }
  };

  // Synchronize playback between source and output videos
  useEffect(() => {
    const source = sourceRef.current;
    const output = outputRef.current;
    if (!source || !output) return;

    let isSeekingFollower = false;

    const handleLoadedMetadata = () => {
      const bestDuration = source.duration || output.duration || duration;
      if (Number.isFinite(bestDuration) && bestDuration > 0) {
        setDuration(bestDuration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(source.currentTime);
      const diff = source.currentTime - output.currentTime;

      // Large drift: align currentTime only if not already seeking
      if (Math.abs(diff) > 0.35) {
        if (!isSeekingFollower && !output.seeking) {
          isSeekingFollower = true;
          output.currentTime = source.currentTime;
        }
      } else if (Math.abs(diff) > 0.05) {
        // Minor drift: adjust playbackRate slightly to catch up without frame stalls
        output.playbackRate = playbackRate * (diff > 0 ? 1.08 : 0.92);
      } else {
        output.playbackRate = playbackRate;
      }
    };

    const handleOutputSeeked = () => {
      isSeekingFollower = false;
      output.playbackRate = playbackRate;
    };

    const handlePlay = () => {
      setPlaying(true);
      if (output.paused) {
        void output.play().catch(() => undefined);
      }
    };

    const handlePause = () => {
      if (!source.seeking && !output.seeking) {
        setPlaying(false);
        if (!output.paused) {
          output.pause();
        }
      }
    };

    const handleEnded = () => {
      if (loop) {
        source.currentTime = 0;
        output.currentTime = 0;
        void Promise.allSettled([source.play(), output.play()]);
      } else {
        setPlaying(false);
        source.pause();
        output.pause();
      }
    };

    source.addEventListener("loadedmetadata", handleLoadedMetadata);
    output.addEventListener("loadedmetadata", handleLoadedMetadata);
    source.addEventListener("timeupdate", handleTimeUpdate);
    output.addEventListener("seeked", handleOutputSeeked);
    source.addEventListener("play", handlePlay);
    source.addEventListener("pause", handlePause);
    source.addEventListener("ended", handleEnded);

    return () => {
      source.removeEventListener("loadedmetadata", handleLoadedMetadata);
      output.removeEventListener("loadedmetadata", handleLoadedMetadata);
      source.removeEventListener("timeupdate", handleTimeUpdate);
      output.removeEventListener("seeked", handleOutputSeeked);
      source.removeEventListener("play", handlePlay);
      source.removeEventListener("pause", handlePause);
      source.removeEventListener("ended", handleEnded);
    };
  }, [job.id, loop, playbackRate, duration]);

  // Synchronize fullscreen state changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function togglePlay() {
    const source = sourceRef.current;
    const output = outputRef.current;
    if (!source || !output) return;

    if (playing) {
      source.pause();
      output.pause();
      setPlaying(false);
      return;
    }

    const maxDur = duration || source.duration || 0;
    const isAtEnd = maxDur > 0 && source.currentTime >= maxDur - 0.15;
    if (isAtEnd) {
      source.currentTime = 0;
      output.currentTime = 0;
      setCurrentTime(0);
    } else {
      output.currentTime = source.currentTime;
    }

    source.playbackRate = playbackRate;
    output.playbackRate = playbackRate;

    try {
      await Promise.all([source.play(), output.play()]);
      setPlaying(true);
    } catch {
      // In case unmuted playback was blocked or one failed
      const active = !source.paused || !output.paused;
      setPlaying(active);
    }
  }

  function handleSeek(targetSeconds: number) {
    const source = sourceRef.current;
    const output = outputRef.current;
    const maxDur = duration || 1;
    const clamped = Math.max(0, Math.min(maxDur, targetSeconds));
    setCurrentTime(clamped);
    if (source) source.currentTime = clamped;
    if (output) output.currentTime = clamped;
  }

  function handleRateChange(rate: number) {
    setPlaybackRate(rate);
    if (sourceRef.current) sourceRef.current.playbackRate = rate;
    if (outputRef.current) outputRef.current.playbackRate = rate;
  }

  function handleToggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (sourceRef.current) sourceRef.current.muted = true;
    if (outputRef.current) outputRef.current.muted = nextMuted;
  }

  function handleToggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      void container.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }

  const effectiveSplit = mode === "split" ? split : mode === "toggle" ? (toggleSide === "source" ? 100 : 0) : 50;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <section className="panel mt-6 overflow-hidden rounded-[28px]">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Compare</p>
          <h3 className="font-serif text-2xl tracking-tight">Before / after</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Selector */}
          <div className="flex rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("split")}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                mode === "split"
                  ? "bg-[var(--gold)] font-medium text-[#2a1c0a]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Split slider
            </button>
            <button
              type="button"
              onClick={() => setMode("side-by-side")}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                mode === "side-by-side"
                  ? "bg-[var(--gold)] font-medium text-[#2a1c0a]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Side by side
            </button>
            <button
              type="button"
              onClick={() => setMode("toggle")}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                mode === "toggle"
                  ? "bg-[var(--gold)] font-medium text-[#2a1c0a]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              A/B Flip
            </button>
          </div>

          {/* Quick Actions */}
          <button
            type="button"
            onClick={() => void togglePlay()}
            className="flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-4 py-2 text-xs uppercase tracking-[0.16em] hover:border-[var(--gold)] hover:text-[var(--gold)]"
          >
            {playing ? (
              <>
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <span>Pause</span>
              </>
            ) : (
              <>
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>Play both</span>
              </>
            )}
          </button>

          {job.outputUrl ? (
            <a
              href={withDownloadParam(job.outputUrl)}
              className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--bg)] hover:opacity-90"
            >
              Download master
            </a>
          ) : null}

          {onContinue ? (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full border border-[var(--gold)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#2a1c0a]"
            >
              Enhance this master
            </button>
          ) : null}
        </div>
      </div>

      {/* Main Video Viewport */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative aspect-video select-none overflow-hidden bg-black ${
          mode === "split" ? "cursor-ew-resize touch-none" : ""
        }`}
      >
        {mode === "side-by-side" ? (
          /* Side by side layout */
          <div className="grid h-full w-full grid-cols-2 divide-x divide-[var(--line)]">
            <div className="relative h-full w-full overflow-hidden bg-black">
              <video
                ref={sourceRef}
                src={job.sourceUrl}
                muted
                playsInline
                preload="auto"
                className="h-full w-full object-contain"
              />
              <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-white backdrop-blur-md">
                Original (Before)
              </div>
            </div>
            <div className="relative h-full w-full overflow-hidden bg-black">
              <video
                ref={outputRef}
                src={job.outputUrl ?? undefined}
                muted={muted}
                playsInline
                preload="auto"
                className="h-full w-full object-contain"
              />
              <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-[var(--gold)]/40 bg-black/60 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--gold)] backdrop-blur-md">
                Enhanced (After)
              </div>
            </div>
          </div>
        ) : (
          /* Split slider and A/B toggle layouts */
          <>
            {/* After (Enhanced) Video - base layer */}
            <video
              ref={outputRef}
              src={job.outputUrl ?? undefined}
              muted={muted}
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-contain"
            />

            {/* Before (Original) Video - clipped top layer */}
            <div
              className="absolute inset-0"
              style={{
                clipPath: `inset(0 ${100 - effectiveSplit}% 0 0)`,
              }}
            >
              <video
                ref={sourceRef}
                src={job.sourceUrl}
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 h-full w-full object-contain"
              />
            </div>

            {/* Floating Badges */}
            <div
              className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/15 bg-black/65 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-white backdrop-blur-md transition-opacity duration-200"
              style={{ opacity: effectiveSplit < 18 ? 0.2 : 1 }}
            >
              Original (Before)
            </div>
            <div
              className="pointer-events-none absolute right-4 top-4 rounded-full border border-[var(--gold)]/50 bg-black/65 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-[var(--gold)] backdrop-blur-md transition-opacity duration-200"
              style={{ opacity: effectiveSplit > 82 ? 0.2 : 1 }}
            >
              Enhanced (After)
            </div>

            {/* Split Mode Interactive Divider & Drag Handle */}
            {mode === "split" && (
              <>
                {/* Vertical Divider Line with drop shadow for contrast */}
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-[var(--gold)] shadow-[0_0_12px_rgba(226,181,122,0.8)]"
                  style={{ left: `${split}%` }}
                />

                {/* Central Draggable Handle */}
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Comparison split"
                  aria-valuenow={Math.round(split)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  onKeyDown={handleSliderKeyDown}
                  className={`group absolute top-1/2 z-30 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[rgba(16,16,22,0.85)] text-[var(--gold)] shadow-2xl backdrop-blur-md transition-transform focus:outline-none focus:ring-2 focus:ring-[var(--gold)] ${
                    isDragging ? "scale-110 shadow-[0_0_20px_rgba(226,181,122,0.5)]" : "hover:scale-105"
                  }`}
                  style={{ left: `${split}%` }}
                >
                  <svg
                    className="h-4 w-4 fill-current transition-transform group-hover:scale-110"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" className="hidden" />
                    <path d="M7 12l5-5v10l-5-5zm10 0l-5 5V7l5 5z" />
                  </svg>

                  {/* Percentage Tooltip on Drag / Hover */}
                  <div
                    className={`pointer-events-none absolute -top-8 rounded-full border border-[var(--gold)]/40 bg-[var(--bg)] px-2 py-0.5 text-[10px] font-mono text-[var(--gold)] shadow-md transition-opacity duration-150 ${
                      isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {Math.round(split)}%
                  </div>
                </div>
              </>
            )}

            {/* A/B Flip Toggle Controls */}
            {mode === "toggle" && (
              <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--line)] bg-[rgba(16,16,22,0.85)] p-1 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setToggleSide("source")}
                  className={`rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                    toggleSide === "source"
                      ? "bg-[var(--ink)] font-semibold text-[#2a1c0a]"
                      : "text-[var(--muted)] hover:text-white"
                  }`}
                >
                  Original
                </button>
                <button
                  type="button"
                  onClick={() => setToggleSide("output")}
                  className={`rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                    toggleSide === "output"
                      ? "bg-[var(--gold)] font-semibold text-[#2a1c0a]"
                      : "text-[var(--muted)] hover:text-white"
                  }`}
                >
                  Enhanced
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Synchronized Playback Control Bar */}
      <div className="border-t border-[var(--line)] bg-[var(--bg-2)] px-6 py-3">
        {/* Scrubber Bar */}
        <div className="mb-3 flex items-center gap-3">
          <span className="w-12 font-mono text-[11px] text-[var(--muted)]">
            {formatDuration(currentTime)}
          </span>
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickPercent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              handleSeek(clickPercent * duration);
            }}
            className="group relative flex h-5 flex-1 cursor-pointer items-center"
          >
            {/* Track Background */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 group-hover:h-2 transition-all">
              <div
                className="h-full bg-[var(--gold)] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Seek Thumb */}
            <div
              className="absolute -translate-x-1/2 rounded-full border-2 border-[var(--gold)] bg-[var(--bg)] shadow-md opacity-0 group-hover:opacity-100 transition-opacity h-3.5 w-3.5"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
          <span className="w-12 text-right font-mono text-[11px] text-[var(--muted)]">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Action Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left Controls: Play, Loop, Volume, Speed */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void togglePlay()}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink)] hover:border-[var(--gold)] hover:text-[var(--gold)]"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Loop Toggle */}
            <button
              type="button"
              onClick={() => setLoop((prev) => !prev)}
              className={`rounded-full border px-2.5 py-1 text-[11px] tracking-wider uppercase transition-colors ${
                loop
                  ? "border-[var(--gold)]/60 bg-[var(--gold)]/10 text-[var(--gold)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Loop
            </button>

            {/* Audio Toggle */}
            <button
              type="button"
              onClick={handleToggleMute}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors ${
                !muted
                  ? "border-[var(--gold)]/60 bg-[var(--gold)]/10 text-[var(--gold)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
              title={muted ? "Unmute audio" : "Mute audio"}
            >
              {muted ? (
                <>
                  <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                  <span>Muted</span>
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                  <span>Sound</span>
                </>
              )}
            </button>

            {/* Playback Rate Selector */}
            <div className="flex items-center rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5">
              {[0.5, 1, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => handleRateChange(rate)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-mono transition-colors ${
                    playbackRate === rate
                      ? "bg-[var(--line-strong)] text-[var(--ink)] font-bold"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* Right Controls: Split Presets (in split mode) & Fullscreen */}
          <div className="flex items-center gap-2">
            {mode === "split" && (
              <div className="hidden sm:flex items-center gap-1 text-[11px] text-[var(--muted)]">
                <span>Split:</span>
                <button
                  type="button"
                  onClick={() => setSplit(0)}
                  className="rounded px-1.5 py-0.5 hover:bg-[var(--line)] hover:text-[var(--ink)]"
                >
                  After (0%)
                </button>
                <button
                  type="button"
                  onClick={() => setSplit(50)}
                  className="rounded px-1.5 py-0.5 hover:bg-[var(--line)] hover:text-[var(--ink)]"
                >
                  50/50
                </button>
                <button
                  type="button"
                  onClick={() => setSplit(100)}
                  className="rounded px-1.5 py-0.5 hover:bg-[var(--line)] hover:text-[var(--ink)]"
                >
                  Before (100%)
                </button>
              </div>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title="Fullscreen"
            >
              {isFullscreen ? (
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Metadata Bar */}
      <div className="grid gap-3 border-t border-[var(--line)] px-6 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] md:grid-cols-2">
        <p>
          Source
          {src
            ? ` · ${formatResolution(src.width, src.height)} · ${formatFps(src.fps)}`
            : ""}
        </p>
        <p>
          Enhanced
          {out
            ? ` · ${formatResolution(out.width, out.height)} · ${formatFps(out.fps)}`
            : ""}
        </p>
      </div>
    </section>
  );
}
