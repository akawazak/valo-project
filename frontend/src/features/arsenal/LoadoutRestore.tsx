import type { LoadoutRestorePoint } from '@/lib/loadoutRestore';
import type { Weapon } from '@/lib/types';
import styles from './LoadoutRestore.module.css';

export default function LoadoutRestore({ point, weapons, busy, onRestore }: { point: LoadoutRestorePoint; weapons: Weapon[]; busy: boolean; onRestore: () => void }) {
    const items = Object.entries(point.request.loadout);
    const includesExtras = Boolean(point.request.identity || point.request.expressions?.length);
    const singleWeapon = items.length === 1 && !includesExtras ? weapons.find(weapon => weapon.uuid === items[0][0]) : null;
    const date = new Date(point.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return <section className={styles.restore} aria-label="Previous loadout">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 9h10a6 6 0 1 1 0 12M4 9l5-5M4 9l5 5" /></svg>
        <div className={styles.copy}><strong>{singleWeapon ? `Previous ${singleWeapon.displayName}` : 'Previous loadout'}</strong><span>Before applying {point.appliedName} <span aria-hidden="true">·</span> {date}</span></div>
        <div className={styles.thumbnails} aria-hidden="true">{items.slice(0, 3).map(([id, item]) => {
            const skin = weapons.find(weapon => weapon.uuid === id)?.skins.find(skin => skin.uuid === item.skinId);
            const art = skin?.chromas.find(chroma => chroma.uuid === item.chromaId)?.fullRender || skin?.displayIcon;
            return art ? <img key={id} src={art} alt="" /> : null;
        })}</div>
        <button type="button" className="btn-tactical btn-tactical-secondary" disabled={busy} onClick={onRestore} title={singleWeapon ? `Restore only your previous ${singleWeapon.displayName}` : 'Restore the equipment changed by your last apply'}>{busy ? 'Working…' : 'Restore'}</button>
    </section>;
}
