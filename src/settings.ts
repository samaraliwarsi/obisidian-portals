import { App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import PortalsPlugin from './main';
import { IconPickerModal } from './iconPicker';

export interface SpaceConfig {
    path: string;
    icon: string;
    color: string;
}

export interface SpacesSettings {
    spaces: SpaceConfig[];
    openFolders: string[];
    selectedSpace: string | null;  // path of the currently active space
}

export const DEFAULT_SETTINGS: SpacesSettings = {
    spaces: [],
    openFolders: [],
    selectedSpace: null
};

export class SpacesSettingTab extends PluginSettingTab {
    plugin: PortalsPlugin;

    constructor(app: App, plugin: PortalsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Portals Settings' });

        // Get all folders in the vault
        const folders: TFolder[] = [];
        const walkFolders = (folder: TFolder) => {
            folders.push(folder);
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    walkFolders(child);
                }
            }
        };
        const root = this.app.vault.getRoot();
        walkFolders(root);

        containerEl.createEl('h3', { text: 'Pinned Portals' });

        for (const folder of folders) {
            const path = folder.path;
            const existing = this.plugin.settings.spaces.find(s => s.path === path);

            const setting = new Setting(containerEl)
                .setName(folder.name)
                .setDesc(path)
                .addToggle(toggle => {
                    toggle.setValue(!!existing).onChange(async (value) => {
                        if (value) {
                            this.plugin.settings.spaces.push({
                                path,
                                icon: 'folder',
                                color: 'transparent'
                            });
                            // If this is the first space, select it automatically
                            if (this.plugin.settings.spaces.length === 1) {
                                this.plugin.settings.selectedSpace = path;
                            }
                        } else {
                            this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => s.path !== path);
                            // If the removed space was selected, clear selection or pick first available
                            if (this.plugin.settings.selectedSpace === path) {
                                this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0]?.path || null;
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    });
                });

            if (existing) {
                // Icon picker button
                setting.addButton(btn => {
                    btn.setButtonText('Choose icon')
                       .onClick(() => {
                            new IconPickerModal(this.app, (iconName) => {
                                existing.icon = iconName;
                                this.plugin.saveSettings();
                                this.display();
                            }).open();
                        });
                });

                // Show current icon name
                setting.descEl.createEl('span', {
                    text: `Current: ${existing.icon}`,
                    cls: 'mod-cta'
                });

                // Color picker
                setting.addText(text => {
                    text.setPlaceholder('Color (e.g. #ff0000)')
                        .setValue(existing.color)
                        .onChange(async (value) => {
                            existing.color = value;
                            await this.plugin.saveSettings();
                        });
                });
            }
        }
    }
}