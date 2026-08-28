import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

interface Tab {
    value: string;
    label: string;
    content: React.ReactNode;
}

interface TabsProps {
    tabs: Tab[];
    defaultValue?: string;
    /** Controlled mode: pass with `onValueChange` to drive the active tab from outside. */
    value?: string;
    onValueChange?: (value: string) => void;
    className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
    tabs,
    defaultValue,
    value,
    onValueChange,
    className,
}) => {
    // Radix rejects `value` and `defaultValue` together, so the two modes are
    // kept mutually exclusive rather than merged.
    const modeProps =
        value !== undefined
            ? { value, onValueChange }
            : { defaultValue: defaultValue || tabs[0]?.value };

    return (
        <TabsPrimitive.Root {...modeProps} className={cn('w-full', className)}>
            <TabsPrimitive.List className="inline-flex min-h-[44px] w-full flex-wrap gap-1 rounded-pill bg-surface-2 p-1">
                {tabs.map((tab) => (
                    <TabsPrimitive.Trigger
                        key={tab.value}
                        value={tab.value}
                        className={cn(
                            'inline-flex flex-1 items-center justify-center rounded-pill px-4 py-2 text-caption font-medium text-muted-foreground',
                            'transition-colors duration-fast ease-soft',
                            'data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-surface',
                        )}
                    >
                        {tab.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            {tabs.map((tab) => (
                <TabsPrimitive.Content
                    key={tab.value}
                    value={tab.value}
                    className="mt-6 focus:outline-none"
                >
                    {tab.content}
                </TabsPrimitive.Content>
            ))}
        </TabsPrimitive.Root>
    );
};
