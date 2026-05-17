import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from 'react';

interface PrivacyContextType {
    hideAmounts: boolean;
    setHideAmounts: (value: boolean) => void;
    toggleHideAmounts: () => void;
}

const STORAGE_KEY = 'privacy.hideAmounts';

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

export const PrivacyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [hideAmounts, setHideAmountsState] = useState<boolean>(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, String(hideAmounts));
        } catch {
            /* ignore storage failures (private mode, quota) */
        }
    }, [hideAmounts]);

    const setHideAmounts = useCallback((value: boolean) => setHideAmountsState(value), []);
    const toggleHideAmounts = useCallback(() => setHideAmountsState((v) => !v), []);

    return (
        <PrivacyContext.Provider value={{ hideAmounts, setHideAmounts, toggleHideAmounts }}>
            {children}
        </PrivacyContext.Provider>
    );
};

export const usePrivacy = () => {
    const context = useContext(PrivacyContext);
    if (context === undefined) {
        throw new Error('usePrivacy must be used within a PrivacyProvider');
    }
    return context;
};
