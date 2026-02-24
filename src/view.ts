import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu } from 'obsidian';
import PortalsPlugin from './main';
import Sortable from 'sortablejs';
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
            spaces: s.spaces.map(sp => `${sp.path}|${sp.icon}|${sp.color}`).join(','),
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

                if (space.icon) {
                    const iconSpan = tab.createSpan({ cls: 'portals-tab-icon' });
                    iconSpan.setAttribute('data-lucide', space.icon);
                }

                const folder = this.app.vault.getAbstractFileByPath(space.path);
                const name = folder instanceof TFolder ? folder.name : space.path.split('/').pop() || space.path;
                tab.createSpan({ text: name });

                tab.addEventListener('click', async () => {
                    this.plugin.settings.selectedSpace = space.path;
                    await this.plugin.saveSettings();
                    this.renderContent();
                });
            }

            // Make tabs sortable
            new Sortable(tabBar, {
                animation: 150,
                onEnd: async (evt) => {
                    const newOrder: SpaceConfig[] = [];
                    const tabElements = tabBar.querySelectorAll('.portals-tab');
                    tabElements.forEach(el => {
                        const path = (el as HTMLElement).dataset.path;
                        if (path) {
                            const found = this.plugin.settings.spaces.find(s => s.path === path);
                            if (found) newOrder.push(found);
                        }
                    });
                    this.plugin.settings.spaces = newOrder;
                    await this.plugin.saveData(this.plugin.settings);
                    this.lastRenderHash = this.getSettingsHash();
                }
            });

            // Content area
            const contentArea = container.createEl('div', { cls: 'portals-content' });

            const selectedSpace = spaces.find(s => s.path === this.plugin.settings.selectedSpace) || spaces[0];
            if (selectedSpace) {
                const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
                if (folder && folder instanceof TFolder) {
                    const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
                    spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
                    this.makeDropTarget(spaceContent, folder);
                    this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
                } else {
                    contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
                }
            }

            this.loadLucideIcons();

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

        const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
        if (folder && folder instanceof TFolder) {
            const spaceContent = contentArea.createEl('div', { cls: 'portals-space-content' });
            spaceContent.style.backgroundColor = selectedSpace.color || 'transparent';
            this.makeDropTarget(spaceContent, folder);
            this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
        } else {
            contentArea.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
        }

        this.loadLucideIcons();
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
        // Helper to execute commands safely
        const exec = (commandId: string) => {
            (this.app as any).commands.executeCommandById(commandId);
        };

        if (file instanceof TFile) {
            // File items
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
                    // Split the current leaf and open
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
            // Folder items
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
                    // Canvas command? Use generic new canvas command
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
        iconSpan.setAttribute('data-lucide', iconName);

        summary.createSpan({ text: folder.name });

        // Make folder a drop target
        this.makeDropTarget(summary, folder);

        // Right-click on folder with full context menu
        summary.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const menu = new Menu();
            // Let plugins add items
            this.app.workspace.trigger('file-menu', menu, folder, 'file-explorer');
            // Add core items (will be appended; duplicates may occur but unlikely)
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
                fileIcon.setAttribute('data-lucide', 'file');
                fileEl.createSpan({ text: child.name });

                // Make file draggable
                fileEl.draggable = true;
                fileEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', child.path);
                });

                // Left-click to open
                fileEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.app.workspace.getLeaf().openFile(child);
                });

                // Right-click with full context menu
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

    loadLucideIcons() {
        if ((window as any).lucide) {
            (window as any).lucide.createIcons();
        } else {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/lucide@latest';
            script.onload = () => (window as any).lucide.createIcons();
            document.head.appendChild(script);
        }
    }
}