"use client";

type EditingPresetBannerProps = {
    presetName: string;
    isVariant?: boolean;
};

export default function EditingPresetBanner({ presetName, isVariant }: EditingPresetBannerProps) {
    return (
        <div className="editing-preset-banner" role="status">
            <span className="editing-preset-banner-dot" aria-hidden="true" />
            <span>
                Editing <strong>{presetName}</strong>
                {isVariant ? ' (variant)' : ''}
                <span className="editing-preset-banner-muted"> — unsaved changes</span>
            </span>
        </div>
    );
}
