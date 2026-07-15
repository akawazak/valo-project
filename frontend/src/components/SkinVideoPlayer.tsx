"use client";

import { useRef, useState } from "react";

type Props = { videoUrl: string; posterUrl?: string; className?: string };

function formatTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

export default function SkinVideoPlayer({ videoUrl, posterUrl, className = "" }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play(); else video.pause();
    };
    const seekTo = (value: number) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = value;
        setCurrentTime(value);
    };
    const changeVolume = (value: number) => {
        if (!videoRef.current) return;
        videoRef.current.volume = value;
        videoRef.current.muted = value === 0;
        setVolume(value);
        setIsMuted(value === 0);
    };
    const toggleMute = () => {
        if (!videoRef.current) return;
        videoRef.current.muted = !videoRef.current.muted;
        setIsMuted(videoRef.current.muted);
    };
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    if (hasError) return <div className="skin-video-unavailable">This preview is unavailable.</div>;
    return <div className={`skin-video-stage ${className}`.trim()} ref={stageRef}>
        {isLoading && <div className="skin-video-loading" aria-live="polite"><span aria-hidden="true" />Loading preview…</div>}
        <video ref={videoRef} src={videoUrl} poster={posterUrl} autoPlay playsInline preload="auto" onClick={togglePlayback} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onCanPlay={() => setIsLoading(false)} onPlaying={() => { setIsLoading(false); setIsPlaying(true); }} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onWaiting={() => setIsLoading(true)} onError={() => { setIsLoading(false); setHasError(true); }} />
        <div className="skin-video-controls">
            <input className="skin-video-progress" type="range" min="0" max={duration || 0} step="0.05" value={Math.min(currentTime, duration || 0)} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Video progress" style={{ background: `linear-gradient(90deg, var(--accent) 0 ${progress}%, rgba(255,255,255,0.24) ${progress}% 100%)` }} />
            <div className="skin-video-control-row">
                <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause preview" : "Play preview"}>{isPlaying ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>}</button>
                <span className="skin-video-time">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
                <div className="skin-video-control-spacer" />
                <div className="skin-video-volume-control"><button type="button" onClick={toggleMute} aria-label={isMuted ? "Unmute preview" : "Mute preview"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={isMuted || volume === 0 ? "M4 9v6h4l5 4V5L8 9zm12 1 4 4m0-4-4 4" : "M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.15v6.3A3.5 3.5 0 0 0 15.5 12z"} /></svg></button><input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Preview volume" /></div>
                <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())} aria-label="Toggle fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v7h2V6h5V4zm9 0v2h5v5h2V4zM4 13v7h7v-2H6v-5zm14 0v5h-5v2h7v-7z" /></svg></button>
            </div>
        </div>
    </div>;
}
