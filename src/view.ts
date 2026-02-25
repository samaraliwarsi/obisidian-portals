import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu } from 'obsidian';
import PortalsPlugin from './main';
import Sortable, { SortableEvent } from 'sortablejs';
import { SpaceConfig } from './settings';

export const VIEW_TYPE_PORTALS = 'portals-view';

export class PortalsView extends ItemView {
    plugin: PortalsPlugin;
    private lastRenderHash: string = '';

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

    private getSettingsHash(): string {
        const s = this.plugin.settings;
        return JSON.stringify({
            spaces: s.spaces.map(sp => `${sp.type}:${sp.path}|${sp.icon}|${sp.color}`).join(','),
            openFolders: s.openFolders.join(','),
            selectedSpace: s.selectedSpace
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

            const spaces = this.plugin.settings.spaces;

            if (spaces.length === 0) {
                container.createEl('p', { text: 'No portals configured. Add some in settings.' });
                return;
            }

            // Tab bar
            const tabBar = container.createEl('div', { cls: 'portals-tab-bar' });

            for (const space of spaces) {
                const tab = tabBar.createEl('div', { cls: 'portals-tab' });
                if (space.path === this.plugin.settings.selectedSpace) {
                    tab.addClass('is-active');
                }
                tab.style.backgroundColor = space.color || 'transparent';
                tab.dataset.path = space.path;
                tab.dataset.type = space.type;

                if (space.icon) {
                    const iconSpan = tab.createSpan({ cls: 'portals-tab-icon' });
                    iconSpan.createEl('i', { cls: `ph ph-${space.icon}` });
                }

                let displayName = '';
                if (space.type === 'folder') {
                    const folder = this.app.vault.getAbstractFileByPath(space.path);
                    displayName = folder instanceof TFolder ? folder.name : space.path;
                } else {
                    displayName = '#' + space.path;
                }

                if (space.path === this.plugin.settings.selectedSpace) {
                    tab.createSpan({ text: displayName });
                } else {
                    tab.title = displayName;
                }

                tab.addEventListener('click', async () => {
                    tabBar.querySelectorAll('.portals-tab').forEach(t => t.removeClass('is-active'));
                    tab.addClass('is-active');
                    this.plugin.settings.selectedSpace = space.path;
                    await this.plugin.saveSettings();
                    this.renderContent();
                    setTimeout(() => {
                        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }, 0);
                });
            }

            // Sortable with touch delay for mobile
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
                        const type = (el as HTMLElement).dataset.type as 'folder' | 'tag';
                        if (path && type) {
                            const found = this.plugin.settings.spaces.find(s => s.path === path && s.type === type);
                            if (found) newOrder.push(found);
                        }
                    });
                    this.plugin.settings.spaces = newOrder;
                    await this.plugin.saveData(this.plugin.settings);
                    this.lastRenderHash = this.getSettingsHash();
                }
            });

            // Scroll initial active tab into view
            setTimeout(() => {
                const activeTab = tabBar.querySelector('.portals-tab.is-active');
                if (activeTab) {
                    activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                }
            }, 0);

            // Content area
            const contentArea = container.createEl('div', { cls: 'portals-content' });

            const selectedSpace = spaces.find(s => s.path === this.plugin.settings.selectedSpace) || spaces[0];
            if (selectedSpace) {
                if (selectedSpace.type === 'folder') {
                    const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
                    if (folder && folder instanceof TFolder) {
                        const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                        spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
                        this.makeDropTarget(spaceContent, folder);
                        this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
                    } else {
                        contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
                    }
                } else {
                    const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                    spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
                    this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
                }
            }

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
                spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
                this.makeDropTarget(spaceContent, folder);
                this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
            } else {
                contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
            }
        } else {
            const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
            spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
            this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
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
            }
        });
    }

    private addCoreFileMenuItems(menu: Menu, file: TFile | TFolder) {
        const exec = (commandId: string) => {
            (this.app as any).commands.executeCommandById(commandId);
        };

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
                    exec('file-explorer:copy-file');
                }));
            menu.addItem(item => item
                .setTitle('Open version history')
                .setIcon('history')
                .onClick(() => {
                    exec('file-explorer:open-file-history');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => {
                    exec('file-explorer:rename-file');
                }));
            menu.addItem(item => item
                .setTitle('Delete')
                .setIcon('trash')
                .onClick(() => {
                    exec('file-explorer:delete-file');
                }));
        } else if (file instanceof TFolder) {
            menu.addItem(item => item
                .setTitle('New note')
                .setIcon('document')
                .onClick(() => {
                    exec('file-explorer:new-note');
                }));
            menu.addItem(item => item
                .setTitle('New folder')
                .setIcon('folder')
                .onClick(() => {
                    exec('file-explorer:new-folder');
                }));
            menu.addItem(item => item
                .setTitle('New canvas')
                .setIcon('layout-dashboard')
                .onClick(() => {
                    exec('canvas:new-canvas');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => {
                    exec('file-explorer:copy-folder');
                }));
            menu.addItem(item => item
                .setTitle('Move folder to...')
                .setIcon('folder-symlink')
                .onClick(() => {
                    exec('file-explorer:move-folder');
                }));
            menu.addSeparator();
            menu.addItem(item => item
                .setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => {
                    exec('file-explorer:rename-folder');
                }));
            menu.addItem(item => item
                .setTitle('Delete')
                .setIcon('trash')
                .onClick(() => {
                    exec('file-explorer:delete-folder');
                }));
            menu.addItem(item => item
                .setTitle('Search in folder')
                .setIcon('search')
                .onClick(() => {
                    exec('global-search:open');
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

        summary.createSpan({ text: folder.name });

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