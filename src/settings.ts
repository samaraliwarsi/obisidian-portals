import { App, PluginSettingTab, Setting, TFolder, Notice } from 'obsidian';
import PortalsPlugin from './main';
import { IconPickerModal } from './iconPicker';

export interface SpaceConfig {
    path: string;
    type: 'folder' | 'tag';
    icon: string;
    color: string;
}

export interface SpacesSettings {
    spaces: SpaceConfig[];
    openFolders: string[];
    selectedSpace: string | null;
    showSubfolders: boolean;
    showTags: boolean;
    replaceFileExplorer: boolean;
    pinVaultRoot: boolean;
    filePaneColorStyle: 'gradient' | 'solid' | 'none';
    tabColorEnabled: boolean;
}

export const DEFAULT_SETTINGS: SpacesSettings = {
    spaces: [],
    openFolders: [],
    selectedSpace: null,
    showSubfolders: true,
    showTags: true,
    replaceFileExplorer: false,
    pinVaultRoot: false,
    filePaneColorStyle: 'gradient',
    tabColorEnabled: true
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

        // Replace file explorer toggle
        new Setting(containerEl)
            .setName('Replace file explorer in left sidebar')
            .setDesc('When enabled, the Portals pane will take the place of the default file explorer in the left sidebar on startup. The file explorer can still be opened via commands if needed.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.replaceFileExplorer)
                .onChange(async (value) => {
                    this.plugin.settings.replaceFileExplorer = value;
                    await this.plugin.saveSettings();
                    new Notice('Changes will take effect after restarting Obsidian.');
                }));

        // ===== FILE PANE COLOR STYLE =====
        new Setting(containerEl)
            .setName('File pane color style')
            .setDesc('How to apply per‑space colors to the file area.')
            .addDropdown(dropdown => dropdown
                .addOption('gradient', 'Gradient (25% solid → fade)')
                .addOption('solid', 'Solid')
                .addOption('none', 'No color (transparent)')
                .setValue(this.plugin.settings.filePaneColorStyle)
                .onChange(async (value: 'gradient' | 'solid' | 'none') => {
                    this.plugin.settings.filePaneColorStyle = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ===== TAB COLORS TOGGLE =====
        new Setting(containerEl)
            .setName('Tab colors')
            .setDesc('Show per‑space background colors on tabs.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.tabColorEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.tabColorEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ===== PIN VAULT ROOT =====
        const pinSetting = new Setting(containerEl)
            .setName('Pin vault root')
            .setDesc('Show the vault root as the first tab (always on the left). You can customize its icon and color below.');

        pinSetting.addToggle(toggle => toggle
            .setValue(this.plugin.settings.pinVaultRoot)
            .onChange(async (value) => {
                this.plugin.settings.pinVaultRoot = value;
                const rootPath = '/';
                if (value) {
                    let root = this.plugin.settings.spaces.find(s => s.path === rootPath && s.type === 'folder');
                    if (!root) {
                        root = {
                            path: rootPath,
                            type: 'folder',
                            icon: 'folder-simple',
                            color: 'transparent'
                        };
                        this.plugin.settings.spaces.unshift(root);
                    } else {
                        const index = this.plugin.settings.spaces.indexOf(root);
                        if (index > 0) {
                            this.plugin.settings.spaces.splice(index, 1);
                            this.plugin.settings.spaces.unshift(root);
                        }
                    }
                    if (!this.plugin.settings.selectedSpace) {
                        this.plugin.settings.selectedSpace = rootPath;
                    }
                } else {
                    this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => !(s.path === rootPath && s.type === 'folder'));
                    if (this.plugin.settings.selectedSpace === rootPath) {
                        this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0]?.path || null;
                    }
                }
                await this.plugin.saveSettings();
                this.display();
            }));

        if (this.plugin.settings.pinVaultRoot) {
            const rootSpace = this.plugin.settings.spaces.find(s => s.path === '/' && s.type === 'folder');
            if (rootSpace) {
                const controlsDiv = pinSetting.controlEl.createDiv({ cls: 'portals-root-controls' });
                controlsDiv.style.marginTop = '8px';
                controlsDiv.style.display = 'flex';
                controlsDiv.style.flexWrap = 'wrap';
                controlsDiv.style.gap = '8px';
                controlsDiv.style.alignItems = 'center';

                const iconBtn = controlsDiv.createEl('button', { text: 'Choose icon' });
                iconBtn.style.marginRight = '4px';
                iconBtn.addEventListener('click', () => {
                    new IconPickerModal(this.app, async (iconName) => {
                        rootSpace.icon = iconName;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });

                controlsDiv.createSpan({ text: `Current icon: ${rootSpace.icon}`, cls: 'mod-cta' });

                const colorInput = controlsDiv.createEl('input', {
                    type: 'text',
                    placeholder: '#ff0000 or rgba(255,0,0,0.5)',
                    value: rootSpace.color
                });
                colorInput.style.width = '150px';

                const preview = controlsDiv.createEl('span', { cls: 'portals-color-preview' });
                preview.style.width = '24px';
                preview.style.height = '24px';
                preview.style.borderRadius = '4px';
                preview.style.border = '1px solid var(--background-modifier-border)';
                preview.style.backgroundColor = rootSpace.color;

                colorInput.addEventListener('input', async () => {
                    rootSpace.color = colorInput.value;
                    preview.style.backgroundColor = rootSpace.color;
                    await this.plugin.saveSettings();
                });
            }
        }

        // ========== FOLDERS SECTION ==========
        containerEl.createEl('h3', { text: 'Folders' });

        new Setting(containerEl)
            .setName('Show subfolders')
            .setDesc('Include subfolders in the list below.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSubfolders)
                .onChange(async (value) => {
                    this.plugin.settings.showSubfolders = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const root = this.app.vault.getRoot();
        const folders: TFolder[] = [];

        if (this.plugin.settings.showSubfolders) {
            const walk = (f: TFolder) => {
                if (f.path !== '/') folders.push(f);
                for (const child of f.children) {
                    if (child instanceof TFolder) {
                        walk(child);
                    }
                }
            };
            walk(root);
        } else {
            for (const child of root.children) {
                if (child instanceof TFolder && child.path !== '/') {
                    folders.push(child);
                }
            }
        }

        folders.sort((a, b) => a.name.localeCompare(b.name));

        for (const folder of folders) {
            const path = folder.path;
            const existing = this.plugin.settings.spaces.find(s => s.type === 'folder' && s.path === path);

            const setting = new Setting(containerEl)
                .setName(folder.name)
                .setDesc(path)
                .addToggle(toggle => {
                    toggle.setValue(!!existing).onChange(async (value) => {
                        if (value) {
                            this.plugin.settings.spaces.push({
                                path,
                                type: 'folder',
                                icon: 'folder-simple',
                                color: 'transparent'
                            });
                            if (this.plugin.settings.spaces.length === 1 && !this.plugin.settings.pinVaultRoot) {
                                this.plugin.settings.selectedSpace = path;
                            }
                        } else {
                            this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => !(s.type === 'folder' && s.path === path));
                            if (this.plugin.settings.selectedSpace === path) {
                                this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0]?.path || null;
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    });
                });

            if (existing) {
                this.addSpaceControls(setting, existing);
            }
        }

        // ========== TAGS SECTION ==========
        containerEl.createEl('h3', { text: 'Tags' });

        new Setting(containerEl)
            .setName('Show tags')
            .setDesc('Include tags in the list below.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTags)
                .onChange(async (value) => {
                    this.plugin.settings.showTags = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.showTags) {
            const tags = (this.app.metadataCache as any).getTags();
            const tagNames = Object.keys(tags).sort();

            for (const tag of tagNames) {
                const tagName = tag.slice(1);
                const existing = this.plugin.settings.spaces.find(s => s.type === 'tag' && s.path === tagName);

                const setting = new Setting(containerEl)
                    .setName(tag)
                    .setDesc(`${tags[tag]} files`)
                    .addToggle(toggle => {
                        toggle.setValue(!!existing).onChange(async (value) => {
                            if (value) {
                                this.plugin.settings.spaces.push({
                                    path: tagName,
                                    type: 'tag',
                                    icon: 'tag',
                                    color: 'transparent'
                                });
                                if (this.plugin.settings.spaces.length === 1 && !this.plugin.settings.pinVaultRoot) {
                                    this.plugin.settings.selectedSpace = tagName;
                                }
                            } else {
                                this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => !(s.type === 'tag' && s.path === tagName));
                                if (this.plugin.settings.selectedSpace === tagName) {
                                    this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0]?.path || null;
                                }
                            }
                            await this.plugin.saveSettings();
                            this.display();
                        });
                    });

                if (existing) {
                    this.addSpaceControls(setting, existing);
                }
            }
        }
    }

    private addSpaceControls(setting: Setting, space: SpaceConfig) {
        setting.addButton(btn => {
            btn.setButtonText('Choose icon')
               .onClick(() => {
                    new IconPickerModal(this.app, (iconName) => {
                        space.icon = iconName;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                });
        });

        setting.descEl.createEl('span', {
            text: `Current: ${space.icon}`,
            cls: 'mod-cta'
        });

        const colorWrapper = setting.controlEl.createDiv({ cls: 'portals-color-wrapper' });
        colorWrapper.style.display = 'flex';
        colorWrapper.style.alignItems = 'center';
        colorWrapper.style.gap = '8px';

        const colorInput = colorWrapper.createEl('input', {
            type: 'text',
            placeholder: '#ff0000 or rgba(255,0,0,0.5)',
            value: space.color
        });
        colorInput.style.flex = '1';

        const preview = colorWrapper.createEl('span', { cls: 'portals-color-preview' });
        preview.style.width = '24px';
        preview.style.height = '24px';
        preview.style.borderRadius = '4px';
        preview.style.border = '1px solid var(--background-modifier-border)';
        preview.style.backgroundColor = space.color;

        colorInput.addEventListener('input', async () => {
            space.color = colorInput.value;
            preview.style.backgroundColor = space.color;
            await this.plugin.saveSettings();
        });
    }
}