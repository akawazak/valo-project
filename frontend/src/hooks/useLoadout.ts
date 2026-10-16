import { useEffect, useRef, useState } from 'react';
import { applyLoadout, ApplyLoadoutRequest, captureAccountRequest, getPlayerLoadoutData, AccountRequestScope } from '@/services/api';
import { LocalClientError } from '@/lib/errors';
import { playUiSound } from '@/lib/uiSounds';
import { captureLoadoutRestore, readLoadoutRestore, writeLoadoutRestore, LoadoutRestorePoint, restoreStorageKey } from '../lib/loadoutRestore';

export function useLoadout(owner: AccountRequestScope | null = null) {
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [isApplying, setIsApplying] = useState(false);
    const pending = useRef(false);
    const ownerKey = owner ? restoreStorageKey(owner) : '';
    const [restoreState, setRestoreState] = useState<{ key: string; point: LoadoutRestorePoint | null }>({ key: '', point: null });
    useEffect(() => {
        setRestoreState({ key: ownerKey, point: readLoadoutRestore(owner) });
        // Re-read after an operation too: the user may switch away and back
        // before its stale response finishes. Token refreshes do not own this state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownerKey, isApplying]);

    const handleApplyLoadout = async (request: ApplyLoadoutRequest, presetName: string) => {
        const scope = captureAccountRequest();
        if (!scope || pending.current) return false;
        pending.current = true;
        setIsApplying(true);
        setShowErrorModal(false);
        setShowToast(false);
        const previous = readLoadoutRestore(scope.owner);
        let captured = false;
        let point: LoadoutRestorePoint | null = null;
        try {
            const before = await getPlayerLoadoutData(scope.owner);
            if (!scope.isCurrent()) return false;
            point = captureLoadoutRestore(before, request, presetName);
            // Persist before dispatch. If storage is unavailable, leave the game unchanged.
            writeLoadoutRestore(scope.owner, point);
            captured = true;
            await applyLoadout(request, scope.owner);
            if (!scope.isCurrent()) return false;
            setRestoreState({ key: restoreStorageKey(scope.owner), point });
            setToastMessage(`Successfully applied ${presetName}.`);
            setShowToast(true);
			playUiSound("success");
            return true;
        } catch (error) {
            if (captured && JSON.stringify(readLoadoutRestore(scope.owner)) === JSON.stringify(point)) {
                // Roll back this account's failed attempt even if another account is
                // now selected. Do not resurrect a deleted or replaced recovery point.
                try { writeLoadoutRestore(scope.owner, previous); } catch { /* Keep the captured recovery point if storage fails. */ }
            }
            if (!scope.isCurrent()) return false;
            setRestoreState({ key: restoreStorageKey(scope.owner), point: readLoadoutRestore(scope.owner) });
			playUiSound("error");
            if (error instanceof LocalClientError) {
                setErrorMessage(error.message);
                setShowErrorModal(true);
            } else {
                console.warn('Loadout could not be applied:', error instanceof Error ? error.message : String(error));
                setErrorMessage(captured ? 'The loadout could not be applied. Refresh your equipment and try again.' : error instanceof Error && error.name !== 'QuotaExceededError' && error.name !== 'SecurityError' ? error.message : 'Your previous loadout could not be saved on this device. Check available storage and try again.');
                setShowErrorModal(true);
            }
            return false;
        } finally {
            pending.current = false;
            setIsApplying(false);
        }
    };

    const handleRestoreLoadout = async () => {
        const scope = captureAccountRequest();
        if (!scope || pending.current) return false;
        const point = readLoadoutRestore(scope.owner);
        if (!point) return false;
        pending.current = true;
        setIsApplying(true);
        setShowErrorModal(false);
        setShowToast(false);
        try {
            await applyLoadout(point.request, scope.owner);
            // A restore is a single undo, not another apply that swaps the two setups.
            if (JSON.stringify(readLoadoutRestore(scope.owner)) === JSON.stringify(point)) {
                try { writeLoadoutRestore(scope.owner, null); } catch { /* Successful restore remains valid if cleanup fails. */ }
            }
            if (!scope.isCurrent()) return false;
            setRestoreState({ key: restoreStorageKey(scope.owner), point: null });
            setToastMessage('Previous loadout restored.');
            setShowToast(true);
            playUiSound('success');
            return true;
        } catch (error) {
            if (!scope.isCurrent()) return false;
            setErrorMessage(error instanceof LocalClientError ? error.message : 'Your previous loadout could not be restored. It is still saved; reconnect and try again.');
            setShowErrorModal(true);
            playUiSound('error');
            return false;
        } finally {
            pending.current = false;
            setIsApplying(false);
        }
    };

    const handleCloseErrorModal = () => {
        setShowErrorModal(false);
    };

    const handleCloseToast = () => {
        setShowToast(false);
    };

    return {
        showToast,
        toastMessage,
        showErrorModal,
        errorMessage,
        handleApplyLoadout,
        handleRestoreLoadout,
        isApplying,
        restorePoint: restoreState.key === ownerKey ? restoreState.point : null,
        handleCloseErrorModal,
        handleCloseToast,
        setShowErrorModal,
        setErrorMessage,
        setShowToast,
        setToastMessage
    };
}
