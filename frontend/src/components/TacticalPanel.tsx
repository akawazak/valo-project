import React from "react";

interface TacticalPanelProps {
    title?: string;
    subtitle?: string;
    className?: string;
    headerAction?: React.ReactNode;
    footer?: React.ReactNode;
    children?: React.ReactNode;
    accent?: "red" | "gold" | "cyan" | "green" | "none";
}

export default function TacticalPanel({
    title,
    subtitle,
    className = "",
    headerAction,
    footer,
    children,
    accent = "none",
}: TacticalPanelProps) {
    const accentClass = accent !== "none" ? `tac-panel-accent-${accent}` : "";

    return (
        <div className={`tac-panel-v3 clip-tactical ${accentClass} ${className}`}>
            {/* Corner Bracket Details */}
            <div className="tac-panel-corner tl" />
            <div className="tac-panel-corner tr" />
            <div className="tac-panel-corner bl" />
            <div className="tac-panel-corner br" />

            {/* Subtle Grid Background Layer */}
            <div className="tac-panel-grid-bg" />

            {/* Panel Header */}
            {(title || subtitle || headerAction) && (
                <div className="tac-panel-v3-header">
                    <div className="tac-panel-v3-title-area">
                        {title && <span className="tac-panel-v3-title">{title}</span>}
                        {subtitle && <span className="tac-panel-v3-subtitle">{subtitle}</span>}
                    </div>
                    {headerAction && <div className="tac-panel-v3-action">{headerAction}</div>}
                </div>
            )}

            {/* Content Area */}
            <div className="tac-panel-v3-body">{children}</div>

            {/* Panel Footer */}
            {footer && <div className="tac-panel-v3-footer">{footer}</div>}
        </div>
    );
}
