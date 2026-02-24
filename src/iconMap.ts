import * as phosphorCore from '@phosphor-icons/core';

const iconsArray = (phosphorCore as any).icons;

if (!iconsArray) {
    console.error('Could not load Phosphor icon names');
}

export const iconNames: string[] = Object.values(iconsArray || {})
    .map((icon: any) => icon.name)
    .filter(Boolean)
    .sort();

console.log(`Loaded ${iconNames.length} Phosphor icon names.`);