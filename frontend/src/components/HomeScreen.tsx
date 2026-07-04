import type { RiotAccount } from "@/lib/types";

type HomeDestination = "store" | "profile" | "skins";

interface HomeScreenProps {
    activeAccount: RiotAccount | null;
    onNavigate: (destination: HomeDestination) => void;
}

export default function HomeScreen({
    activeAccount,
    onNavigate,
}: HomeScreenProps) {
    const playerName = activeAccount?.gameName || "Player";
    const playerTag = activeAccount?.tagLine ? `#${activeAccount.tagLine}` : "";

    return (
        <section className="home-screen">
            <div className="home-screen-content">
                <nav className="home-launch-nav" aria-label="Home shortcuts">
                    <button type="button" onClick={() => onNavigate("store")}>Storefront</button>
                    <button type="button" onClick={() => onNavigate("profile")}>Profile</button>
                    <button type="button" onClick={() => onNavigate("skins")}>Presets</button>
                </nav>

                <div className="home-welcome">
                    <span>Welcome back</span>
                    <strong>{playerName}</strong>
                    <small>{playerTag || "VantaVault ready"}</small>
                </div>
            </div>

        </section>
    );
}
