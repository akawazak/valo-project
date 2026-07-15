"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SkinVideoModalProps = {
    title: string;
    videoUrl: string;
    posterUrl?: string;
    onClose: () => void;
};

function formatTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
}

export default function SkinVideoModal({ title, videoUrl, posterUrl, onClose }: SkinVideoModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !document.fullscreenElement) onClose();
        };
        const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        window.addEventListener("keydown", handleKeyDown);
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, [onClose]);

    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
    };

    const seekTo = (value: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = value;
        setCurrentTime(value);
    };

    const changeVolume = (value: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = value;
        video.muted = value === 0;
        setVolume(value);
        setIsMuted(value === 0);
    };

    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setIsMuted(video.muted);
    };

    const toggleFullscreen = async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stageRef.current?.requestFullscreen();
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return createPortal(
        <div className="skin-video-backdrop" role="presentation" onMouseDown={onClose}>
            <section
                className="skin-video-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`${title} video preview`}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="skin-video-header">
                    <div>
                        <span>// SKIN PREVIEW</span>
                        <h3>{title}</h3>
                    </div>
                    <div className="skin-video-header-actions">
                        <small>Esc to close</small>
                        <button type="button" onClick={onClose} aria-label="Close video preview">×</button>
                    </div>
                </div>
                {hasError ? (
                    <div className="skin-video-unavailable">This preview video is unavailable.</div>
                ) : (
                    <div className="skin-video-stage" ref={stageRef}>
                        {isLoading && (
                            <div className="skin-video-loading" aria-live="polite">
                                <span aria-hidden="true" />
                                Loading preview…
                            </div>
                        )}
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            poster={posterUrl}
                            autoPlay
                            playsInline
                            preload="auto"
                            onClick={togglePlayback}
                            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                            onCanPlay={() => setIsLoading(false)}
                            onPlaying={() => {
                                setIsLoading(false);
                                setIsPlaying(true);
                            }}
                            onPause={() => setIsPlaying(false)}
                            onEnded={() => setIsPlaying(false)}
                            onWaiting={() => setIsLoading(true)}
                            onError={() => {
                                setIsLoading(false);
                                setHasError(true);
                            }}
                        />
                        <div className="skin-video-controls">
                            <input
                                className="skin-video-progress"
                                type="range"
                                min="0"
                                max={duration || 0}
                                step="0.05"
                                value={Math.min(currentTime, duration || 0)}
                                onChange={(event) => seekTo(Number(event.target.value))}
                                aria-label="Video progress"
                                style={{ background: `linear-gradient(90deg, var(--accent) 0 ${progress}%, rgba(255,255,255,0.24) ${progress}% 100%)` }}
                            />
                            <div className="skin-video-control-row">
                                <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause preview" : "Play preview"}>
                                    {isPlaying ? (
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" /></svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>
                                    )}
                                </button>
                                <span className="skin-video-time">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
                                <div className="skin-video-control-spacer" />
                                <div className="skin-video-volume-control">
                                    <button type="button" onClick={toggleMute} aria-label={isMuted ? "Unmute preview" : "Mute preview"}>
                                        {isMuted || volume === 0 ? (
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm12.4 1.2-1.4 1.4 1.4 1.4-1.4 1.4 1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4-1.4-1.4 1.4z" /></svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.15v6.3A3.5 3.5 0 0 0 15.5 12zm-2-6.4v2.1a5 5 0 0 1 0 8.6v2.1a7 7 0 0 0 0-12.8z" /></svg>
                                        )}
                                    </button>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={isMuted ? 0 : volume}
                                        onChange={(event) => changeVolume(Number(event.target.value))}
                                        aria-label="Preview volume"
                                    />
                                </div>
                                <button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
                                    {isFullscreen ? (
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4v2h7V4zm6 0h-2v7h7V9h-5zM4 15v2h5v3h2v-5zm9 0v5h2v-3h5v-2z" /></svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v7h2V6h5V4zm9 0v2h5v5h2V4zM4 13v7h7v-2H6v-5zm14 0v5h-5v2h7v-7z" /></svg>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>,
        document.body,
    );
}
