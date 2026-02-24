import { App, Modal, Setting } from 'obsidian';

export class IconPickerModal extends Modal {
    onSubmit: (iconName: string) => void;

    constructor(app: App, onSubmit: (iconName: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Choose an icon' });

        const commonIcons = [
            'folder', 'home', 'book', 'user', 'star', 'heart', 'settings',
            'camera', 'music', 'code', 'file', 'image', 'calendar', 'clock',
            'flag', 'gift', 'key', 'lock', 'mail', 'map', 'phone', 'save',
            'search', 'tag', 'trash', 'upload', 'video', 'zap', 'activity'
        ];

        new Setting(contentEl)
            .setName('Icon')
            .addDropdown(drop => {
                commonIcons.forEach(icon => drop.addOption(icon, icon));
                drop.onChange(value => {
                    this.onSubmit(value);
                    this.close();
                });
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    onClose() {
        this.contentEl.empty();
    }
}