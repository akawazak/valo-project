import { useState } from 'react';
import { applyLoadout, ApplyLoadoutRequest } from '@/services/api';
import { LocalClientError } from '@/lib/errors';

export function useLoadout() {
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const handleApplyLoadout = async (request: ApplyLoadoutRequest, presetName: string) => {
        try {
            await applyLoadout(request);
            setToastMessage(`Successfully applied ${presetName}.`);
            setShowToast(true);
        } catch (error) {
            if (error instanceof LocalClientError) {
                setErrorMessage(error.message);
                setShowErrorModal(true);
            } else {
                console.error(error);
                setErrorMessage('An unexpected error occurred.');
                setShowErrorModal(true);
            }
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
        handleCloseErrorModal,
        handleCloseToast,
        setShowErrorModal,
        setErrorMessage,
        setShowToast,
        setToastMessage
    };
}
