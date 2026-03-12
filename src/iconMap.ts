import { icons } from '@phosphor-icons/core';

let iconNames: string[] = [];

try {
    if (icons && Array.isArray(icons)) {
        iconNames = icons.map(icon => icon.name).sort();
    } else {
        console.error('Portals: @phosphor-icons/core icons array not found');
    }
} catch (e) {
    console.error('Portals: Failed to load Phosphor icon names', e);
}

export { iconNames };