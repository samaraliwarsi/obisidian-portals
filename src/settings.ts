import { App, PluginSettingTab, Setting, TFolder, Notice, Modal } from 'obsidian';
import PortalsPlugin from './main';
import { IconPickerModal } from './iconPicker';
import { PortalsView, VIEW_TYPE_PORTALS } from 'view';

export interface SpaceConfig {
    path: string;
    type: 'folder' | 'tag';
    icon: string;
    color: string;
}

export interface SpacesSettings {
    spaces: SpaceConfig[];
    openFolders: string[];
    selectedSpace: { path: string; type: 'folder' | 'tag' } | null;
    replaceFileExplorer: boolean;
    pinVaultRoot: boolean;
    filePaneColorStyle: 'gradient' | 'solid' | 'none';
    tabColorEnabled: boolean;
    sortBy: 'name' | 'created' | 'modified';
    sortOrder: 'asc' | 'desc';
    showInactiveTabNames: boolean;
    secondaryPanelHeight: number;
    secondaryPanelCollapsed: boolean;
    showRecentFiles: boolean;
    recentFilesList: string[];
    splitViewTabs: string[];
    activeSplitTab: string;
    splitViewTabIcons: Record<string, string>
}

export const DEFAULT_SETTINGS: SpacesSettings = {
    spaces: [],
    openFolders: [],
    selectedSpace: null,
    replaceFileExplorer: false,
    pinVaultRoot: false,
    filePaneColorStyle: 'gradient',
    tabColorEnabled: true,
    sortBy: 'name',
    showInactiveTabNames: false,
    sortOrder: 'asc',
    secondaryPanelHeight: 200,
    secondaryPanelCollapsed: false,
    showRecentFiles: false,
    recentFilesList: [],
    splitViewTabs: ['recent', 'folder-notes'],
    activeSplitTab: 'recent',
    splitViewTabIcons: {
        recent: 'clock',
        'folder-notes': 'note'
    },
};

export class SpacesSettingTab extends PluginSettingTab {
    plugin: PortalsPlugin;

    constructor(app: App, plugin: PortalsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const scrollTop = containerEl.scrollTop;
        containerEl.empty();

        // Main header
        containerEl.createEl('h2', { text: 'Portals Settings' });

        // ---- Settings toggles (unchanged) ----
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

        new Setting(containerEl)
            .setName('Show inactive tab names')
            .setDesc('Always display the name of inactive tabs (may increase tab bar width).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showInactiveTabNames)
                .onChange(async (value) => {
                    this.plugin.settings.showInactiveTabNames = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('Show recent files pane')
            .setDesc('Display a list of recently opened files in a separate panel below the file tree.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showRecentFiles)
                .onChange(async (value) => {
                    this.plugin.settings.showRecentFiles = value;
                    await this.plugin.saveSettings();
                    this.display();
                    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PORTALS).forEach(leaf => {
                        if (leaf.view instanceof PortalsView) leaf.view.render();
                    });
                }));

        // ---- PIN VAULT ROOT (two‑row layout) ----
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
                        root = { path: rootPath, type: 'folder', icon: 'folder-simple', color: 'transparent' };
                        this.plugin.settings.spaces.unshift(root);
                    } else {
                        const index = this.plugin.settings.spaces.indexOf(root);
                        if (index > 0) {
                            this.plugin.settings.spaces.splice(index, 1);
                            this.plugin.settings.spaces.unshift(root);
                        }
                    }
                    if (!this.plugin.settings.selectedSpace)
                        this.plugin.settings.selectedSpace = { path: rootPath, type: 'folder' };
                } else {
                    this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => !(s.path === rootPath && s.type === 'folder'));
                    if (this.plugin.settings.selectedSpace?.path === rootPath && this.plugin.settings.selectedSpace?.type === 'folder')
                        this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0] 
                            ? { path: this.plugin.settings.spaces[0].path, type: this.plugin.settings.spaces[0].type }
                            : null;
                }
                await this.plugin.saveSettings();
                this.display();
            }));

                if (this.plugin.settings.pinVaultRoot) {
            const rootSpace = this.plugin.settings.spaces.find(s => s.path === '/' && s.type === 'folder');
            if (rootSpace) {
                // Use the same inline layout as regular portals
                const controlEl = pinSetting.controlEl;
                controlEl.style.display = 'flex';
                controlEl.style.alignItems = 'center';
                controlEl.style.gap = '8px';
                controlEl.style.flexWrap = 'wrap';
                controlEl.style.marginTop = '8px';

                // "Choose icon" button
                const iconBtn = controlEl.createEl('button', { text: 'Choose icon' });
                iconBtn.addEventListener('click', () => {
                    new IconPickerModal(this.app, async (iconName) => {
                        rootSpace.icon = iconName;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });

                // Color picker wrapper (same as addPortalControls)
                const colorWrapper = controlEl.createDiv({ cls: 'portals-color-wrapper' });
                colorWrapper.style.display = 'flex';
                colorWrapper.style.alignItems = 'center';
                colorWrapper.style.gap = '8px';
                colorWrapper.style.flexWrap = 'wrap';

                let initialHex = '#ff0000';
                let initialOpacity = 1;
                if (rootSpace.color && rootSpace.color !== 'transparent') {
                    const rgba = rootSpace.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (rgba) {
                        initialHex = `#${Number(rgba[1]).toString(16).padStart(2,'0')}${Number(rgba[2]).toString(16).padStart(2,'0')}${Number(rgba[3]).toString(16).padStart(2,'0')}`;
                        initialOpacity = rgba[4] ? parseFloat(rgba[4]) : 1;
                    } else if (rootSpace.color.startsWith('#')) {
                        initialHex = rootSpace.color;
                    }
                }

                const colorInput = colorWrapper.createEl('input', { type: 'color', value: initialHex });
                colorInput.style.width = '40px';
                colorInput.style.height = '30px';
                colorInput.style.padding = '0';
                colorInput.style.border = 'none';
                colorInput.style.cursor = 'pointer';

                const opacitySlider = colorWrapper.createEl('input', {
                    type: 'range',
                    value: String(initialOpacity * 100),
                    attr: { min: '0', max: '100', step: '1' }
                });
                opacitySlider.style.width = '80px';

                const opacityValue = colorWrapper.createSpan({ text: `${Math.round(initialOpacity * 100)}%` });
                opacityValue.style.minWidth = '40px';
                opacityValue.style.fontSize = '12px';

                const preview = colorWrapper.createEl('span', { cls: 'portals-color-preview' });
                preview.style.width = '24px';
                preview.style.height = '24px';
                preview.style.borderRadius = '4px';
                preview.style.border = '1px solid var(--background-modifier-border)';
                preview.style.backgroundColor = rootSpace.color !== 'transparent' ? rootSpace.color : 'transparent';

                const updateRootColor = () => {
                    const hex = colorInput.value;
                    const opacity = parseInt(opacitySlider.value) / 100;
                    const r = parseInt(hex.slice(1,3), 16);
                    const g = parseInt(hex.slice(3,5), 16);
                    const b = parseInt(hex.slice(5,7), 16);
                    const rgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    rootSpace.color = rgba;
                    preview.style.backgroundColor = rgba;
                    opacityValue.setText(`${Math.round(opacity * 100)}%`);
                    this.plugin.saveSettings();
                };

                colorInput.addEventListener('input', updateRootColor);
                opacitySlider.addEventListener('input', updateRootColor);
            }
        }

        // ---- ADD PORTAL BUTTON (above categories) ----
        new Setting(containerEl)
            .setName('Add new portal')
            .setDesc('Add a folder or tag as a portal tab.')
            .addButton(btn => btn
                .setButtonText('Add')
                .setCta()
                .onClick(() => {
                    new AddPortalModal(this.app, async (path: string, type: 'folder' | 'tag') => {
                        if (this.plugin.settings.spaces.some(s => s.path === path && s.type === type)) {
                            new Notice('This portal already exists.');
                            return;
                        }
                        this.plugin.settings.spaces.push({
                            path,
                            type,
                            icon: type === 'folder' ? 'folder-simple' : 'tag',
                            color: 'transparent'
                        });
                        if (this.plugin.settings.spaces.length === 1 && !this.plugin.settings.pinVaultRoot) {
                            this.plugin.settings.selectedSpace = { path, type };
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        containerEl.createEl('hr');

        // ---- CATEGORIZED PORTALS ----
        const getPortalDisplayName = (portal: SpaceConfig): string => {
            if (portal.type === 'folder') {
                if (portal.path === '/') return this.app.vault.getName();
                const folder = this.app.vault.getAbstractFileByPath(portal.path);
                return folder instanceof TFolder ? folder.name : portal.path;
            } else {
                return '#' + portal.path;
            }
        };

        const rootFolders: SpaceConfig[] = [];
        const subFolders: SpaceConfig[] = [];
        const tags: SpaceConfig[] = [];

        for (const portal of this.plugin.settings.spaces) {
            if (portal.type === 'tag') {
                tags.push(portal);
            } else {
                if (portal.path === '/') {
                    rootFolders.push(portal);
                } else {
                    const folder = this.app.vault.getAbstractFileByPath(portal.path);
                    if (folder instanceof TFolder) {
                        const isRoot = folder.parent === this.app.vault.getRoot();
                        if (isRoot) rootFolders.push(portal);
                        else subFolders.push(portal);
                    } else {
                        if (portal.path.includes('/')) subFolders.push(portal);
                        else rootFolders.push(portal);
                    }
                }
            }
        }

        const sortByName = (a: SpaceConfig, b: SpaceConfig) => {
            const nameA = getPortalDisplayName(a).toLowerCase();
            const nameB = getPortalDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        };
        rootFolders.sort(sortByName);
        subFolders.sort(sortByName);
        tags.sort(sortByName);

        const renderSection = (title: string, portals: SpaceConfig[]) => {
            if (portals.length === 0) return;

            const details = containerEl.createEl('details');
            details.setAttr('open', 'true');
            details.style.marginBottom = '16px';

            const summary = details.createEl('summary');
            summary.style.cursor = 'pointer';
            summary.style.fontWeight = 'bold';
            summary.style.padding = '4px 0';
            summary.createSpan({ text: title });

            for (const portal of portals) {
                const setting = new Setting(details)
                    .setName(getPortalDisplayName(portal))
                    .setDesc(`${portal.type} · ${portal.path}`);  // ONLY type and path

                // Icon button + icon name (no extra "Current:" label)
                setting.addButton(btn => btn
                    .setButtonText('Choose icon')
                    .onClick(() => {
                        new IconPickerModal(this.app, (iconName) => {
                            portal.icon = iconName;
                            this.plugin.saveSettings();
                            this.display();
                        }).open();
                    }));

                // Display current icon name
                setting.descEl.createSpan({ text: `  ${portal.icon}`, cls: 'mod-cta' });

                // Color picker wrapper
                const colorWrapper = setting.controlEl.createDiv({ cls: 'portals-color-wrapper' });
                colorWrapper.style.display = 'flex';
                colorWrapper.style.alignItems = 'center';
                colorWrapper.style.gap = '8px';
                colorWrapper.style.flexWrap = 'wrap';

                let initialHex = '#ff0000';
                let initialOpacity = 1;
                if (portal.color && portal.color !== 'transparent') {
                    const rgba = portal.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (rgba) {
                        initialHex = `#${Number(rgba[1]).toString(16).padStart(2,'0')}${Number(rgba[2]).toString(16).padStart(2,'0')}${Number(rgba[3]).toString(16).padStart(2,'0')}`;
                        initialOpacity = rgba[4] ? parseFloat(rgba[4]) : 1;
                    } else if (portal.color.startsWith('#')) {
                        initialHex = portal.color;
                    }
                }

                const colorInput = colorWrapper.createEl('input', { type: 'color', value: initialHex });
                colorInput.style.width = '40px';
                colorInput.style.height = '30px';
                colorInput.style.padding = '0';
                colorInput.style.border = 'none';
                colorInput.style.cursor = 'pointer';

                const opacitySlider = colorWrapper.createEl('input', {
                    type: 'range',
                    value: String(initialOpacity * 100),
                    attr: { min: '0', max: '100', step: '1' }
                });
                opacitySlider.style.width = '80px';

                const opacityValue = colorWrapper.createSpan({ text: `${Math.round(initialOpacity * 100)}%` });
                opacityValue.style.minWidth = '40px';
                opacityValue.style.fontSize = '12px';

                const preview = colorWrapper.createEl('span', { cls: 'portals-color-preview' });
                preview.style.width = '24px';
                preview.style.height = '24px';
                preview.style.borderRadius = '4px';
                preview.style.border = '1px solid var(--background-modifier-border)';
                preview.style.backgroundColor = portal.color !== 'transparent' ? portal.color : 'transparent';

                const updateColor = () => {
                    const hex = colorInput.value;
                    const opacity = parseInt(opacitySlider.value) / 100;
                    const r = parseInt(hex.slice(1,3), 16);
                    const g = parseInt(hex.slice(3,5), 16);
                    const b = parseInt(hex.slice(5,7), 16);
                    const rgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    portal.color = rgba;
                    preview.style.backgroundColor = rgba;
                    opacityValue.setText(`${Math.round(opacity * 100)}%`);
                    this.plugin.saveSettings();
                };

                colorInput.addEventListener('input', updateColor);
                opacitySlider.addEventListener('input', updateColor);

                // Trash button
                setting.addButton(btn => btn
                    .setIcon('trash')
                    .setWarning()
                    .setTooltip('Remove this portal')
                    .onClick(async () => {
                        this.plugin.settings.spaces = this.plugin.settings.spaces.filter(s => s !== portal);
                        if (this.plugin.settings.selectedSpace?.path === portal.path && this.plugin.settings.selectedSpace?.type === portal.type) {
                            this.plugin.settings.selectedSpace = this.plugin.settings.spaces[0] 
                                ? { path: this.plugin.settings.spaces[0].path, type: this.plugin.settings.spaces[0].type }
                                : null;
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }));
            }
        };

        renderSection('Root Folders', rootFolders);
        renderSection('Sub Folders', subFolders);
        renderSection('Tags', tags);

        // ---- Backup / Restore ----
        containerEl.createEl('h3', { text: 'Backup / Restore' });

        new Setting(containerEl)
            .setName('Export settings')
            .setDesc('Download your current portals configuration as a JSON file.')
            .addButton(button => button.setButtonText('Export').onClick(() => this.exportSettings()));

        new Setting(containerEl)
            .setName('Import settings')
            .setDesc('Load settings from a JSON file. This will replace your current configuration.')
            .addButton(button => button.setButtonText('Import').onClick(() => this.importSettings()));

        // ---- Maintenance ----
        containerEl.createEl('h3', { text: 'Maintenance' });

        new Setting(containerEl)
            .setName('Clean up dead portals')
            .setDesc('Remove portal tabs for folders or tags that no longer exist. This cannot be undone.')
            .addButton(button => button
                .setButtonText('Clean now')
                .setWarning()
                .onClick(async () => {
                    const removed = await this.plugin.cleanupDeadSpaces();
                    new Notice(removed > 0 ? `Removed ${removed} dead portal(s)` : 'No dead portals found');
                    this.display();
                }));

        // Restore scroll
        setTimeout(() => {
            const maxScroll = containerEl.scrollHeight - containerEl.clientHeight;
            containerEl.scrollTop = Math.min(scrollTop, maxScroll);
        }, 0);
    }

    private exportSettings() {
        const data = JSON.stringify(this.plugin.settings, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portals-settings-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        new Notice('Settings exported');
    }

    private importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const imported = JSON.parse(text);
                this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, imported);
                await this.plugin.saveSettings();
                this.display();
                new Notice('Settings imported successfully');
            } catch (e) {
                new Notice('Invalid settings file');
            }
        };
        input.click();
    }
}

// ==================== ADD PORTAL MODAL ====================
class AddPortalModal extends Modal {
    private selectedPath: string = '';
    private currentTab: 'root' | 'sub' | 'tag' = 'root';
    private searchInput: HTMLInputElement;
    private resultsContainer: HTMLElement;
    private rootFolders: TFolder[] = [];
    private subFolders: TFolder[] = [];
    private allTags: string[] = [];

    constructor(app: App, private onChoose: (path: string, type: 'folder' | 'tag') => void) {
        super(app);
        const root = app.vault.getRoot();
        const walk = (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFolder) {
                    if (f === root) this.rootFolders.push(child);
                    else this.subFolders.push(child);
                    walk(child);
                }
            }
        };
        walk(root);
        this.rootFolders.sort((a, b) => a.name.localeCompare(b.name));
        this.subFolders.sort((a, b) => a.name.localeCompare(b.name));

        const tagsObj = (app.metadataCache as any).getTags();
        this.allTags = Object.keys(tagsObj).map(t => t.slice(1)).sort();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add a new portal' });

        // Tab bar
        const tabBar = contentEl.createDiv({ cls: 'add-portal-tab-bar' });
        tabBar.style.display = 'flex';
        tabBar.style.gap = '4px';
        tabBar.style.marginBottom = '1em';
        tabBar.style.borderBottom = '1px solid var(--background-modifier-border)';
        tabBar.style.paddingBottom = '4px';

        const createTab = (id: 'root' | 'sub' | 'tag', label: string) => {
            const tab = tabBar.createEl('div', { cls: 'add-portal-tab' });
            tab.textContent = label;
            tab.style.padding = '4px 8px';
            tab.style.cursor = 'pointer';
            tab.style.borderRadius = '4px 4px 0 0';
            if (this.currentTab === id) {
                tab.style.background = 'var(--interactive-accent)';
                tab.style.color = 'var(--text-on-accent)';
            }
            tab.addEventListener('click', () => {
                this.currentTab = id;
                this.selectedPath = '';
                this.filterResults();
                tabBar.querySelectorAll('.add-portal-tab').forEach(t => {
                    (t as HTMLElement).style.background = '';
                    (t as HTMLElement).style.color = '';
                });
                tab.style.background = 'var(--interactive-accent)';
                tab.style.color = 'var(--text-on-accent)';
            });
        };

        createTab('root', 'Root Folders');
        createTab('sub', 'Sub Folders');
        createTab('tag', 'Tags');

        this.searchInput = contentEl.createEl('input', { type: 'text', placeholder: 'Search...' });
        this.searchInput.style.width = '100%';
        this.searchInput.style.marginBottom = '1em';
        this.searchInput.addEventListener('input', () => this.filterResults());

        this.resultsContainer = contentEl.createDiv({ cls: 'add-portal-results' });
        this.resultsContainer.style.maxHeight = '300px';
        this.resultsContainer.style.overflowY = 'auto';
        this.resultsContainer.style.border = '1px solid var(--background-modifier-border)';
        this.resultsContainer.style.borderRadius = '4px';
        this.resultsContainer.style.padding = '4px';

        this.filterResults();

        const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonDiv.style.marginTop = '1em';
        buttonDiv.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const addBtn = buttonDiv.createEl('button', { text: 'Add', cls: 'mod-cta' });
        addBtn.addEventListener('click', () => {
            if (!this.selectedPath) {
                new Notice('Please select a folder or tag.');
                return;
            }
            this.onChoose(this.selectedPath, this.currentTab === 'tag' ? 'tag' : 'folder');
            this.close();
        });
    }

    private filterResults() {
        this.resultsContainer.empty();
        const query = this.searchInput.value.toLowerCase();

        if (this.currentTab === 'tag') {
            const filtered = this.allTags.filter(t => t.toLowerCase().includes(query));
            for (const tag of filtered) {
                const item = this.resultsContainer.createDiv({ cls: 'add-portal-item' });
                item.style.padding = '4px 8px';
                item.style.cursor = 'pointer';
                item.style.borderRadius = '2px';
                item.textContent = '#' + tag;
                item.addEventListener('click', () => {
                    this.resultsContainer.querySelectorAll('.add-portal-item').forEach(el => {
                        (el as HTMLElement).style.background = '';
                        (el as HTMLElement).style.color = '';
                    });
                    item.style.background = 'var(--interactive-accent)';
                    item.style.color = 'var(--text-on-accent)';
                    this.selectedPath = tag;
                });
                item.addEventListener('mouseenter', () => {
                    if (item.style.background !== 'var(--interactive-accent)')
                        item.style.background = 'var(--background-modifier-hover)';
                });
                item.addEventListener('mouseleave', () => {
                    if (item.style.background !== 'var(--interactive-accent)')
                        item.style.background = '';
                });
            }
        } else {
            const folders = this.currentTab === 'root' ? this.rootFolders : this.subFolders;
            const filtered = folders.filter(f => f.path.toLowerCase().includes(query) || f.name.toLowerCase().includes(query));
            for (const folder of filtered) {
                const item = this.resultsContainer.createDiv({ cls: 'add-portal-item' });
                item.style.padding = '4px 8px';
                item.style.cursor = 'pointer';
                item.style.borderRadius = '2px';
                item.textContent = folder.path;
                item.addEventListener('click', () => {
                    this.resultsContainer.querySelectorAll('.add-portal-item').forEach(el => {
                        (el as HTMLElement).style.background = '';
                        (el as HTMLElement).style.color = '';
                    });
                    item.style.background = 'var(--interactive-accent)';
                    item.style.color = 'var(--text-on-accent)';
                    this.selectedPath = folder.path;
                });
                item.addEventListener('mouseenter', () => {
                    if (item.style.background !== 'var(--interactive-accent)')
                        item.style.background = 'var(--background-modifier-hover)';
                });
                item.addEventListener('mouseleave', () => {
                    if (item.style.background !== 'var(--interactive-accent)')
                        item.style.background = '';
                });
            }
        }
    }

    onClose() { this.contentEl.empty(); }
}