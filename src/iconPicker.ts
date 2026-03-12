import { App, Modal } from 'obsidian';
import { iconNames } from './iconMap';

export class IconPickerModal extends Modal {
    onSubmit: (iconName: string) => void;
    private searchTimeout: number | null = null;

    constructor(app: App, onSubmit: (iconName: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('icon-picker-modal');

        contentEl.createEl('h2', { text: 'Choose an icon' });

        const searchInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Search icons...'
        });
        searchInput.style.width = '100%';
        searchInput.style.marginBottom = '16px';
        searchInput.style.padding = '8px';
        searchInput.style.borderRadius = '4px';
        searchInput.style.border = '1px solid var(--background-modifier-border)';

        const iconGrid = contentEl.createEl('div', { cls: 'portals-icon-grid' });

        const renderIcons = (filter: string) => {
            if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
            this.searchTimeout = window.setTimeout(() => {
                iconGrid.empty();
                const filtered = filter
                    ? iconNames.filter((name: string) => name.toLowerCase().includes(filter.toLowerCase()))
                    : iconNames;

                const toRender = filter ? filtered : filtered.slice(0, 500);

                if (toRender.length === 0) {
                    iconGrid.createEl('p', { text: 'No icons found.' });
                    return;
                }

                for (const name of toRender) {
                    const iconEl = iconGrid.createEl('div', { cls: 'icon-item' });

                    // Create an <i> element with the Phosphor icon class
                    const iEl = iconEl.createEl('i', { cls: `ph ph-${name}` });
                    iEl.style.fontSize = '24px';

                    const label = iconEl.createEl('span', { cls: 'portals-icon-label', text: name });
                    

                    iconEl.addEventListener('click', () => {
                        this.onSubmit(name);
                        this.close();
                    });

                    iconEl.addEventListener('mouseenter', () => {
                        iconEl.style.backgroundColor = 'var(--background-modifier-hover)';
                    });
                    iconEl.addEventListener('mouseleave', () => {
                        iconEl.style.backgroundColor = '';
                    });
                }
            }, 200);
        };

        renderIcons('');

        searchInput.addEventListener('input', () => renderIcons(searchInput.value));

        const buttonContainer = contentEl.createEl('div', { cls: 'icon-picker-buttons' });
        buttonContainer.createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => this.close());
    }

    onClose() {
        if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
        this.contentEl.empty();
    }
}