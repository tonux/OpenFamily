import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppToastProvider } from './components/ui';
import { queryClient } from './lib/queryClient';
import './i18n'; // self-initializes i18next; must run before any t() call
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <QueryClientProvider client={queryClient}>
                <ThemeProvider>
                    <AppToastProvider>
                        <AuthProvider>
                            <App />
                        </AuthProvider>
                    </AppToastProvider>
                </ThemeProvider>
            </QueryClientProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
