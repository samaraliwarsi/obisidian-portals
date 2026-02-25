import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu, Notice } from 'obsidian';
import PortalsPlugin from './main';
import Sortable, { SortableEvent } from 'sortablejs';
import { SpaceConfig } from './settings';

export const VIEW_TYPE_PORTALS = 'portals-view';

export class PortalsView extends ItemView {
    plugin: PortalsPlugin;
    private lastRenderHash: string = '';
    private tooltipEl: HTMLElement | null = null;
    private tooltipTimeout: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: PortalsPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_PORTALS;
    }

    getDisplayText(): string {
        return 'Portals';
    }

    getIcon(): string {
        return 'folder-tree';
    }

    async onOpen() {
        this.render();
    }

    async onClose() {
        if (this.tooltipEl) {
            this.tooltipEl.remove();
            this.tooltipEl = null;
        }
        if (this.tooltipTimeout) {
            window.clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
    }

    private getTooltipEl(): HTMLElement {
        if (!this.tooltipEl) {
            this.tooltipEl = document.body.createDiv({ cls: 'portals-floating-tooltip' });
        }
        return this.tooltipEl;
    }

    private showTooltip(text: string, target: HTMLElement) {
        const tooltip = this.getTooltipEl();
        tooltip.setText(text);

        const rect = target.getBoundingClientRect();
        tooltip.style.top = (rect.bottom + 6) + 'px';
        tooltip.style.left = (rect.left + rect.width / 2) + 'px';
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.display = 'block';

        if (this.tooltipTimeout) {
            window.clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
    }

    private hideTooltip(delay = 0) {
        if (delay > 0) {
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.tooltipEl) {
                    this.tooltipEl.style.display = 'none';
                }
            }, delay);
        } else {
            if (this.tooltipEl) {
                this.tooltipEl.style.display = 'none';
            }
        }
    }

    private getSettingsHash(): string {
        const s = this.plugin.settings;
        return JSON.stringify({
            spaces: s.spaces.map(sp => `${sp.type}:${sp.path}|${sp.icon}|${sp.color}`).join(','),
            openFolders: s.openFolders.join(','),
            selectedSpace: s.selectedSpace,
            filePaneColorStyle: s.filePaneColorStyle,
            tabColorEnabled: s.tabColorEnabled
        });
    }

    async render() {
        const newHash = this.getSettingsHash();
        if (newHash === this.lastRenderHash) return;
        this.lastRenderHash = newHash;

        try {
            const container = this.containerEl.children[1] as HTMLElement;
            if (!container) return;
            container.empty();
            container.addClass('portals-container');
            container.style.position = 'relative';

            const spaces = this.plugin.settings.spaces;

            if (spaces.length === 0) {
                container.createEl('p', { text: 'No portals configured. Add some in settings.' });
                return;
            }

            // Tab bar
            const tabBar = container.createEl('div', { cls: 'portals-tab-bar' });

            for (const space of spaces) {
                let displayName = '';
                const vaultName = this.app.vault.getName();

                if (space.type === 'folder') {
                    if (space.path === '/') {
                        displayName = vaultName; // root shows vault name
                    } else {
                        const folder = this.app.vault.getAbstractFileByPath(space.path);
                        displayName = folder instanceof TFolder ? folder.name : space.path;
                    }
                } else {
                    displayName = '#' + space.path;
                }

                const tab = tabBar.createEl('div', { cls: 'portals-tab' });
                if (space.path === '/') {
                    tab.addClass('portals-tab-pinned');
                }

                const isActive = (space.path === this.plugin.settings.selectedSpace);

                if (isActive) {
                    tab.addClass('is-active');
                    if (space.path !== '/') {
                        tab.createSpan({ text: displayName });
                    }
                } else {
                    tab.addEventListener('mouseenter', () => {
                        this.showTooltip(displayName, tab);
                    });
                    tab.addEventListener('mouseleave', () => {
                        this.hideTooltip(100);
                    });
                }

                if (this.plugin.settings.tabColorEnabled) {
                    tab.style.background = space.color || 'transparent';
                } else {
                    tab.style.background = '';
                }

                tab.dataset.path = space.path;
                tab.dataset.type = space.type;

                if (space.icon) {
                    const iconSpan = tab.createSpan({ cls: 'portals-tab-icon' });
                    iconSpan.createEl('i', { cls: `ph ph-${space.icon}` });
                }

                tab.addEventListener('click', async () => {
                    this.hideTooltip(0);
                    this.plugin.settings.selectedSpace = space.path;

                    if (space.type === 'folder' && !this.plugin.settings.openFolders.includes(space.path)) {
                        this.plugin.settings.openFolders.push(space.path);
                    }

                    await this.plugin.saveSettings();
                    await this.render();
                    const newActiveTab = container.querySelector('.portals-tab.is-active');
                    if (newActiveTab) {
                        setTimeout(() => {
                            newActiveTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                        }, 0);
                    }
                });
            }

            new Sortable(tabBar, {
                animation: 150,
                delay: 400,
                delayOnTouchOnly: true,
                touchStartThreshold: 5,
                scrollSensitivity: 30,
                onEnd: async (evt: SortableEvent) => {
                    const newOrder: SpaceConfig[] = [];
                    const tabElements = tabBar.querySelectorAll('.portals-tab');
                    tabElements.forEach(el => {
                        const path = (el as HTMLElement).dataset.path;
                        const type = (el as HTMLElement).dataset.type;
                        if (path && (type === 'folder' || type === 'tag')) {
                            const found = this.plugin.settings.spaces.find(s => s.path === path && s.type === type);
                            if (found) {
                                newOrder.push(found);
                            }
                        }
                    });

                    if (this.plugin.settings.pinVaultRoot) {
                        const rootIndex = newOrder.findIndex(s => s.path === '/' && s.type === 'folder');
                        if (rootIndex > 0) {
                            const root = newOrder.splice(rootIndex, 1)[0];
                            if (root) {
                                newOrder.unshift(root);
                            }
                        }
                    }

                    this.plugin.settings.spaces = newOrder;
                    await this.plugin.saveData(this.plugin.settings);
                    this.lastRenderHash = this.getSettingsHash();
                }
            });

            setTimeout(() => {
                const activeTab = tabBar.querySelector('.portals-tab.is-active');
                if (activeTab) {
                    activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                }
            }, 0);

            const contentArea = container.createEl('div', { cls: 'portals-content' });

            const selectedSpace = spaces.find(s => s.path === this.plugin.settings.selectedSpace) || spaces[0];
            if (selectedSpace) {
                if (selectedSpace.type === 'folder') {
                    const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
                    if (folder && folder instanceof TFolder) {
                        const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                        this.applySpaceBackground(spaceContent, selectedSpace.color);
                        this.makeDropTarget(spaceContent, folder);
                        this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
                    } else {
                        contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
                    }
                } else {
                    const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                    this.applySpaceBackground(spaceContent, selectedSpace.color);
                    this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
                }
            }

            // Floating collapse button
            const collapseBtn = container.createEl('button', { cls: 'portals-collapse-all-btn' });
            collapseBtn.createEl('i', { cls: 'ph ph-stack' });
            collapseBtn.addEventListener('click', async () => {
                const currentSpacePath = this.plugin.settings.selectedSpace;
                if (!currentSpacePath) return;

                this.plugin.settings.openFolders = [currentSpacePath];
                await this.plugin.saveSettings();
                this.renderContent();
            });

        } catch (e) {
            console.error('Portals render error:', e);
        }
    }

    async renderContent() {
        const container = this.containerEl.children[1] as HTMLElement;
        const contentArea = container.querySelector('.portals-content');
        if (!contentArea) return;

        contentArea.empty();

        const spaces = this.plugin.settings.spaces;
        const selectedSpace = spaces.find(s => s.path === this.plugin.settings.selectedSpace) || spaces[0];
        if (!selectedSpace) return;

        if (selectedSpace.type === 'folder') {
            const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
            if (folder && folder instanceof TFolder) {
                const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                this.applySpaceBackground(spaceContent, selectedSpace.color);
                this.makeDropTarget(spaceContent, folder);
                this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
            } else {
                contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
            }
        } else {
            const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
            this.applySpaceBackground(spaceContent, selectedSpace.color);
            this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
        }
    }

    private applySpaceBackground(el: HTMLElement, color: string | undefined) {
        const bgColor = color || 'transparent';
        const style = this.plugin.settings.filePaneColorStyle;

        if (style === 'none' || bgColor === 'transparent') {
            el.style.background = 'transparent';
            return;
        }

        if (style === 'solid') {
            el.style.background = bgColor;
        } else if (style === 'gradient') {
            el.style.background = `linear-gradient(to bottom, ${bgColor} 25%, transparent)`;
        }
    }

    private buildTagSpace(tagName: string, container: HTMLElement, iconName: string) {
        const tag = '#' + tagName;
        const allFiles = this.app.vault.getMarkdownFiles();
        const taggedFiles = allFiles.filter(file => {
            const cache = this.app.metadataCache.getFileCache(file);
            return cache?.tags?.some(t => t.tag === tag) || cache?.frontmatter?.tags?.includes(tagName);
        });

        if (taggedFiles.length === 0) {
            container.createEl('p', { text: 'No files with this tag.' });
            return;
        }

        for (const file of taggedFiles) {
            const fileEl = container.createDiv({ cls: 'file-item' });
            const fileIcon = fileEl.createSpan({ cls: 'file-icon' });
            fileIcon.createEl('i', { cls: 'ph ph-file' });
            fileEl.createSpan({ text: file.name });

            fileEl.dataset.path = file.path;
            fileEl.draggable = true;
            fileEl.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', file.path);
            });

            fileEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.workspace.getLeaf().openFile(file);
            });

            fileEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const menu = new Menu();
                this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');
                this.addCoreFileMenuItems(menu, file);
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });
        }
    }

    private makeDropTarget(el: HTMLElement, folder: TFolder) {
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.addClass('drag-over');
        });
        el.addEventListener('dragleave', () => {
            el.removeClass('drag-over');
        });
        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.removeClass('drag-over');
            const filePath = e.dataTransfer?.getData('text/plain');
            if (!filePath) return;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile)) return;
            const newPath = `${folder.path}/${file.name}`;
            if (newPath === file.path) return;
            try {
                await this.app.vault.rename(file, newPath);
                this.renderContent();
            } catch (err) {
                console.error('Drop error:', err);
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Failed to move file: ${message}`);
            }
        });
    }

    // Helper to safely execute commands and show errors
    private safeExecute(commandId: string, successMessage?: string) {
        try {
            (this.app as any).commands.executeCommandById(commandId);
            if (successMessage) {
                new Notice(successMessage);
            }
        } catch (err) {
            console.error(`Command failed: ${commandId}`, err);
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Command failed: ${message}`);
        }
    }

    private addCoreFileMenuItems(menu: Menu, file: TFile | TFolder) {
        // Use safeExecute for all command calls
        if (file instanceof TFile) {
            menu.addItem(item => item
                .setTitle('Open in new tab')
                .setIcon('document')
                .onClick(() => {
                    this.app.workspace.getLeaf('tab').openFile(file);
                }));
            menu.addItem(item => item
                .setTitle('Open to the right')
                .setIcon('file-symlink')
                .onClick(() => {
                    this.app.workspace.getLeaf('split', 'vertical').openFile(file);
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => {
                    this.safeExecute('file-explorer:copy-file');
                }));
            menu.addItem(item => item
                .setTitle('Open version history')
                .setIcon('history')
                .onClick(() => {
                    this.safeExecute('file-explorer:open-file-history');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => {
                    this.safeExecute('file-explorer:rename-file');
                }));
            menu.addItem(item => item
                .setTitle('Delete')
                .setIcon('trash')
                .onClick(() => {
                    this.safeExecute('file-explorer:delete-file');
                }));
        } else if (file instanceof TFolder) {
            menu.addItem(item => item
                .setTitle('New note')
                .setIcon('document')
                .onClick(() => {
                    this.safeExecute('file-explorer:new-note');
                }));
            menu.addItem(item => item
                .setTitle('New folder')
                .setIcon('folder')
                .onClick(() => {
                    this.safeExecute('file-explorer:new-folder');
                }));
            menu.addItem(item => item
                .setTitle('New canvas')
                .setIcon('layout-dashboard')
                .onClick(() => {
                    this.safeExecute('canvas:new-canvas');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => {
                    this.safeExecute('file-explorer:copy-folder');
                }));
            menu.addItem(item => item
                .setTitle('Move folder to...')
                .setIcon('folder-symlink')
                .onClick(() => {
                    this.safeExecute('file-explorer:move-folder');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => {
                    this.safeExecute('file-explorer:rename-folder');
                }));
            menu.addItem(item => item
                .setTitle('Delete')
                .setIcon('trash')
                .onClick(() => {
                    this.safeExecute('file-explorer:delete-folder');
                }));
            menu.addItem(item => item
                .setTitle('Search in folder')
                .setIcon('search')
                .onClick(() => {
                    this.safeExecute('global-search:open');
                }));
        }
    }

    buildFolderTree(folder: TFolder, container: HTMLElement, iconName: string = 'folder') {
        const details = container.createEl('details');
        details.addClass('folder-details');

        if (this.plugin.settings.openFolders.includes(folder.path)) {
            details.setAttr('open', 'true');
        }

        const summary = details.createEl('summary');
        summary.addClass('folder-summary');

        const iconSpan = summary.createSpan({ cls: 'folder-icon' });
        iconSpan.createEl('i', { cls: `ph ph-${iconName}` });

        const displayName = folder.path === '/' ? this.app.vault.getName() : folder.name;
        summary.createSpan({ text: displayName });

        this.makeDropTarget(summary, folder);

        summary.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const menu = new Menu();
            this.app.workspace.trigger('file-menu', menu, folder, 'file-explorer');
            this.addCoreFileMenuItems(menu, folder);
            menu.showAtPosition({ x: e.clientX, y: e.clientY });
        });

        const childrenContainer = details.createDiv({ cls: 'folder-children' });

        const sorted = folder.children.sort((a, b) => {
            const aIsFolder = a instanceof TFolder;
            const bIsFolder = b instanceof TFolder;
            if (aIsFolder && !bIsFolder) return -1;
            if (!aIsFolder && bIsFolder) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const child of sorted) {
            if (child instanceof TFolder) {
                this.buildFolderTree(child, childrenContainer, 'folder');
            } else if (child instanceof TFile) {
                const fileEl = childrenContainer.createDiv({ cls: 'file-item' });
                const fileIcon = fileEl.createSpan({ cls: 'file-icon' });
                fileIcon.createEl('i', { cls: 'ph ph-file' });
                fileEl.createSpan({ text: child.name });

                fileEl.dataset.path = child.path;
                fileEl.draggable = true;
                fileEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', child.path);
                });

                fileEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.app.workspace.getLeaf().openFile(child);
                });

                fileEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const menu = new Menu();
                    this.app.workspace.trigger('file-menu', menu, child, 'file-explorer');
                    this.addCoreFileMenuItems(menu, child);
                    menu.showAtPosition({ x: e.clientX, y: e.clientY });
                });
            }
        }

        details.addEventListener('toggle', async () => {
            const path = folder.path;
            let openFolders = this.plugin.settings.openFolders;
            if (details.open) {
                if (!openFolders.includes(path)) {
                    openFolders.push(path);
                }
            } else {
                openFolders = openFolders.filter(p => p !== path);
            }
            this.plugin.settings.openFolders = openFolders;
            await this.plugin.saveSettings();
        });
    }
}