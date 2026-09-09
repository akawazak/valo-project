"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";

type ResilientAssetImageProps = {
    sources: Array<string | null | undefined>;
    alt: string;
    className?: string;
    style?: CSSProperties;
    fallback?: ReactNode;
};

export default function ResilientAssetImage({
    sources,
    alt,
    className,
    style,
    fallback = null,
}: ResilientAssetImageProps) {
    const candidates = useMemo(
        () => Array.from(new Set(sources.map(source => source?.trim()).filter((source): source is string => Boolean(source)))),
        [sources],
    );
    const candidateKey = candidates.join("|");
    const [candidateIndex, setCandidateIndex] = useState(0);

    useEffect(() => {
        setCandidateIndex(0);
    }, [candidateKey]);

    useEffect(() => {
        if (candidates.length === 0 || candidateIndex < candidates.length) return;
        const retry = window.setTimeout(() => setCandidateIndex(0), 120_000);
        return () => window.clearTimeout(retry);
    }, [candidateIndex, candidates.length]);

    const source = candidates[candidateIndex];
    if (!source) return <>{fallback}</>;

    return (
        <img
            src={source}
            alt={alt}
            className={className}
            style={style}
            onError={() => setCandidateIndex(index => index + 1)}
        />
    );
}
