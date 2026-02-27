import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu, Notice, Modal, App, Platform } from 'obsidian';
import PortalsPlugin from './main';
import Sortable, { SortableEvent } from 'sortablejs';
import { SpaceConfig } from './settings';

// Simple text input modal for rename
class InputModal extends Modal {
    constructor(
        app: App,
        private title: string,
        private placeholder: string,
        private defaultValue: string,
        private onSubmit: (value: string) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.title });

        const input = contentEl.createEl('input', {
            type: 'text',
            value: this.defaultValue,
            placeholder: this.placeholder
        });
        input.style.width = '100%';
        input.style.marginBottom = '1em';

        const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonDiv.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const submitBtn = buttonDiv.createEl('button', { text: 'Submit', cls: 'mod-cta' });
        submitBtn.addEventListener('click', () => {
            this.onSubmit(input.value);
            this.close();
        });

        input.focus();
        input.select();
    }

    onClose() {
        this.contentEl.empty();
    }
}

export const VIEW_TYPE_PORTALS = 'portals-view';

export class PortalsView extends ItemView {
    plugin: PortalsPlugin;
    private lastRenderHash: string = '';
    private tooltipEl: HTMLElement | null = null;
    private tooltipTimeout: number | null = null;
    private vaultEventRef: (() => void) | null = null;

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

        const renameRef = this.app.vault.on('rename', () => this.renderContent());
        const deleteRef = this.app.vault.on('delete', () => this.renderContent());
        const createRef = this.app.vault.on('create', () => this.renderContent());

        this.vaultEventRef = () => {
            this.app.vault.offref(renameRef);
            this.app.vault.offref(deleteRef);
            this.app.vault.offref(createRef);
        };
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
        if (this.vaultEventRef) {
            this.vaultEventRef();
            this.vaultEventRef = null;
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
            tabColorEnabled: s.tabColorEnabled,
            sortBy: s.sortBy,
            sortOrder: s.sortOrder
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
                    if (this.plugin.settings.tabColorEnabled && space.color && space.color !== 'transparent') {
                        tab.style.borderLeft = `2px solid ${space.color}`;
                    } else {
                        tab.style.borderLeft = '';
                    }
                }

                const isActive = (space.path === this.plugin.settings.selectedSpace);

                if (isActive) {
                    tab.addClass('is-active');
                    if (space.path !== '/') {
                        tab.createSpan({ text: displayName });
                    }
                } else {
                    if (!Platform.isMobile) {
                        tab.addEventListener('mouseenter', () => {
                            this.showTooltip(displayName, tab);
                        });
                        tab.addEventListener('mouseleave', () => {
                            this.hideTooltip(100);
                        });
                    }
                }

                // Apply tab color only to active tab's bottom border
                if (this.plugin.settings.tabColorEnabled && space.color && space.color !== 'transparent') {
                    if (isActive) {
                        tab.style.borderBottomColor = space.color;
                    } else {
                        tab.style.borderBottomColor = ''; // ensure no leftover inline border
                    }
                } else {
                    tab.style.borderBottomColor = '';
                }

                // No background set inline – CSS will handle inactive tabs
                tab.style.background = '';

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
                        this.makeDropTarget(spaceContent, folder, true);
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

            // ===== FLOATING BUTTONS =====

            // Helper to create a floating button
            const createFloatingButton = (icon: string, tooltip: string, bottom: number, onClick: (e: MouseEvent) => void) => {
                const btn = container.createEl('button', { cls: 'portals-floating-btn' });
                btn.style.bottom = bottom + 'px';
                btn.createEl('i', { cls: `ph ph-${icon}` });
                if (!Platform.isMobile) {
                    btn.addEventListener('mouseenter', () => this.showTooltip(tooltip, btn));
                    btn.addEventListener('mouseleave', () => this.hideTooltip(100));
                }
                btn.addEventListener('click', onClick);
                return btn;
            };

            // New note button (only works in folder spaces)
            createFloatingButton('file-plus', 'New note', 148, async () => {
                const currentSpace = this.plugin.settings.spaces.find(s => s.path === this.plugin.settings.selectedSpace);
                if (!currentSpace || currentSpace.type !== 'folder') {
                    new Notice('Please select a folder space first.');
                    return;
                }
                const folder = this.app.vault.getAbstractFileByPath(currentSpace.path);
                if (!(folder instanceof TFolder)) {
                    new Notice('Selected space is not a valid folder.');
                    return;
                }
                await this.newNoteInFolder(folder);
            });

            // New folder button (only works in folder spaces)
            createFloatingButton('folder-simple-plus', 'New folder', 104, async () => {
                const currentSpace = this.plugin.settings.spaces.find(s => s.path === this.plugin.settings.selectedSpace);
                if (!currentSpace || currentSpace.type !== 'folder') {
                    new Notice('Please select a folder space first.');
                    return;
                }
                const folder = this.app.vault.getAbstractFileByPath(currentSpace.path);
                if (!(folder instanceof TFolder)) {
                    new Notice('Selected space is not a valid folder.');
                    return;
                }
                await this.newFolderInFolder(folder);
            });

            // Sort button
            createFloatingButton('caret-circle-up-down', 'Sort', 60, (e: MouseEvent) => {
                const menu = new Menu();
                const setSort = (by: 'name' | 'created' | 'modified', order: 'asc' | 'desc') => {
                    this.plugin.settings.sortBy = by;
                    this.plugin.settings.sortOrder = order;
                    this.plugin.saveSettings();
                    this.renderContent();
                };
                menu.addItem(item => item
                    .setTitle('Name (A → Z)')
                    .setChecked(this.plugin.settings.sortBy === 'name' && this.plugin.settings.sortOrder === 'asc')
                    .onClick(() => setSort('name', 'asc')));
                menu.addItem(item => item
                    .setTitle('Name (Z → A)')
                    .setChecked(this.plugin.settings.sortBy === 'name' && this.plugin.settings.sortOrder === 'desc')
                    .onClick(() => setSort('name', 'desc')));
                menu.addSeparator();
                menu.addItem(item => item
                    .setTitle('Created (oldest first)')
                    .setChecked(this.plugin.settings.sortBy === 'created' && this.plugin.settings.sortOrder === 'asc')
                    .onClick(() => setSort('created', 'asc')));
                menu.addItem(item => item
                    .setTitle('Created (newest first)')
                    .setChecked(this.plugin.settings.sortBy === 'created' && this.plugin.settings.sortOrder === 'desc')
                    .onClick(() => setSort('created', 'desc')));
                menu.addSeparator();
                menu.addItem(item => item
                    .setTitle('Modified (oldest first)')
                    .setChecked(this.plugin.settings.sortBy === 'modified' && this.plugin.settings.sortOrder === 'asc')
                    .onClick(() => setSort('modified', 'asc')));
                menu.addItem(item => item
                    .setTitle('Modified (newest first)')
                    .setChecked(this.plugin.settings.sortBy === 'modified' && this.plugin.settings.sortOrder === 'desc')
                    .onClick(() => setSort('modified', 'desc')));
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });

            // Collapse button
            createFloatingButton('stack', 'Collapse all', 16, async () => {
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
                this.makeDropTarget(spaceContent, folder, true);
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

    // Helper to get display name (hide .md extension)
    private getDisplayName(file: TFile): string {
        if (file.extension === 'md') {
            return file.basename;
        }
        return file.name;
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
            fileEl.createSpan({ text: this.getDisplayName(file) });

            fileEl.dataset.path = file.path;

            // Disable drag on mobile
            if (!Platform.isMobile) {
                fileEl.draggable = true;
                fileEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', file.path);
                });
            }

            fileEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.workspace.getLeaf().openFile(file);
            });

            fileEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showFileContextMenu(e, file);
            });
        }
    }

    // ========== CONTEXT MENU ==========

    private showFileContextMenu(event: MouseEvent, file: TFile) {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle('Open in new tab')
            .setIcon('document')
            .onClick(() => this.app.workspace.getLeaf('tab').openFile(file)));

        menu.addItem(item => item
            .setTitle('Open to the right')
            .setIcon('file-symlink')
            .onClick(() => this.app.workspace.getLeaf('split', 'vertical').openFile(file)));

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle('Duplicate')
            .setIcon('copy')
            .onClick(() => this.duplicateFile(file)));

        menu.addItem(item => item
            .setTitle('Rename')
            .setIcon('pencil')
            .onClick(() => this.renameFile(file)));

        menu.addItem(item => item
            .setTitle('Delete')
            .setIcon('trash')
            .onClick(() => this.deleteFile(file)));

        menu.addSeparator();

        this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private showFolderContextMenu(event: MouseEvent, folder: TFolder) {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle('New note')
            .setIcon('document')
            .onClick(() => this.newNoteInFolder(folder)));

        menu.addItem(item => item
            .setTitle('New folder')
            .setIcon('folder')
            .onClick(() => this.newFolderInFolder(folder)));

        menu.addItem(item => item
            .setTitle('New canvas')
            .setIcon('layout-dashboard')
            .onClick(() => this.newCanvasInFolder(folder)));

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle('Duplicate')
            .setIcon('copy')
            .onClick(() => this.executeCommand('file-explorer:copy-folder')));

        menu.addItem(item => item
            .setTitle('Rename')
            .setIcon('pencil')
            .onClick(() => this.renameFolder(folder)));

        menu.addItem(item => item
            .setTitle('Delete')
            .setIcon('trash')
            .onClick(() => this.deleteFolder(folder)));

        menu.addSeparator();

        this.app.workspace.trigger('file-menu', menu, folder, 'file-explorer');

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private executeCommand(commandId: string) {
        try {
            (this.app as any).commands.executeCommandById(commandId);
        } catch (err) {
            console.error(`Command failed: ${commandId}`, err);
            new Notice(`Command failed: ${err}`);
        }
    }

    // ========== FILE OPERATIONS (Direct) ==========

    private async duplicateFile(file: TFile) {
        const dir = file.parent?.path || '';
        const newName = this.getDuplicateName(file.name);
        const newPath = `${dir}/${newName}`;
        try {
            await this.app.vault.copy(file, newPath);
            new Notice(`Duplicated to ${newName}`);
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Duplicate failed: ${message}`);
        }
    }

    private getDuplicateName(original: string): string {
        const ext = original.includes('.') ? original.slice(original.lastIndexOf('.')) : '';
        const base = original.includes('.') ? original.slice(0, original.lastIndexOf('.')) : original;
        let counter = 1;
        let candidate = `${base} ${counter}${ext}`;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            counter++;
            candidate = `${base} ${counter}${ext}`;
        }
        return candidate;
    }

    // ===== RENAME FUNCTIONS (show base name only, preserve extension) =====
    private async renameFile(file: TFile) {
        const displayName = file.basename;
        new InputModal(this.app, 'Rename file', 'New name', displayName, async (newBase) => {
            if (!newBase || newBase === displayName) return;
            const newName = newBase + '.' + file.extension;
            const dir = file.parent?.path || '';
            const newPath = `${dir}/${newName}`;
            try {
                await this.app.vault.rename(file, newPath);
                new Notice('File renamed');
                this.renderContent();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Rename failed: ${message}`);
            }
        }).open();
    }

    private async renameFolder(folder: TFolder) {
        new InputModal(this.app, 'Rename folder', 'New name', folder.name, async (newName) => {
            if (!newName || newName === folder.name) return;
            const parent = folder.parent?.path || '';
            const newPath = parent ? `${parent}/${newName}` : newName;
            try {
                await this.app.vault.rename(folder, newPath);
                new Notice('Folder renamed');
                this.renderContent();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Rename failed: ${message}`);
            }
        }).open();
    }
    // ===============================================================

    private async deleteFile(file: TFile) {
        const confirmMsg = `Delete "${file.name}"?`;
        if (!confirm(confirmMsg)) return;
        try {
            await this.app.vault.trash(file, false);
            new Notice('File moved to trash');
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Delete failed: ${message}`);
        }
    }

    private async deleteFolder(folder: TFolder) {
        const confirmMsg = `Delete folder "${folder.name}" and all its contents?`;
        if (!confirm(confirmMsg)) return;
        try {
            await this.app.vault.trash(folder, false);
            new Notice('Folder moved to trash');
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Delete failed: ${message}`);
        }
    }

    private async newNoteInFolder(folder: TFolder) {
        const defaultName = 'Untitled.md';
        let candidate = `${folder.path}/${defaultName}`;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${folder.path}/Untitled ${counter}.md`;
            counter++;
        }
        try {
            await this.app.vault.create(candidate, '');
            new Notice('Note created');
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create note: ${message}`);
        }
    }

    private async newFolderInFolder(parent: TFolder) {
        const defaultName = 'New Folder';
        let candidate = `${parent.path}/${defaultName}`;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${parent.path}/New Folder ${counter}`;
            counter++;
        }
        try {
            await this.app.vault.createFolder(candidate);
            new Notice('Folder created');
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create folder: ${message}`);
        }
    }

    private async newCanvasInFolder(folder: TFolder) {
        const defaultName = 'Untitled.canvas';
        let candidate = `${folder.path}/${defaultName}`;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${folder.path}/Untitled ${counter}.canvas`;
            counter++;
        }
        try {
            await this.app.vault.create(candidate, '');
            new Notice('Canvas created');
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create canvas: ${message}`);
        }
    }

    // ========== DRAG & DROP ==========

    private makeDropTarget(el: HTMLElement, folder: TFolder, allowFolders: boolean = false) {
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
            if (!file) return;

            const targetPath = `${folder.path}/${file.name}`;
            if (targetPath === file.path) return;

            try {
                if (file instanceof TFile) {
                    await this.app.vault.rename(file, targetPath);
                    new Notice(`Moved to ${folder.name}`);
                } else if (allowFolders && file instanceof TFolder) {
                    if (targetPath.startsWith(file.path + '/') || targetPath === file.path) {
                        new Notice('Cannot move folder into itself');
                        return;
                    }
                    await this.app.vault.rename(file, targetPath);
                    new Notice(`Moved folder to ${folder.name}`);
                } else {
                    new Notice('Cannot move this item');
                    return;
                }
                this.renderContent();
            } catch (err) {
                console.error('Drop error:', err);
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Failed to move: ${message}`);
            }
        });
    }

    // ========== FOLDER TREE ==========

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

        // Disable drag on mobile
        if (!Platform.isMobile) {
            summary.draggable = true;
            summary.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', folder.path);
            });
        }

        this.makeDropTarget(summary, folder, true);

        summary.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showFolderContextMenu(e, folder);
        });

        const childrenContainer = details.createDiv({ cls: 'folder-children' });

        const sorted = this.sortFolderChildren(Array.from(folder.children));

        for (const child of sorted) {
            if (child instanceof TFolder) {
                this.buildFolderTree(child, childrenContainer, 'folder');
            } else if (child instanceof TFile) {
                const fileEl = childrenContainer.createDiv({ cls: 'file-item' });
                const fileIcon = fileEl.createSpan({ cls: 'file-icon' });
                fileIcon.createEl('i', { cls: 'ph ph-file' });
                fileEl.createSpan({ text: this.getDisplayName(child) });

                fileEl.dataset.path = child.path;

                // Disable drag on mobile
                if (!Platform.isMobile) {
                    fileEl.draggable = true;
                    fileEl.addEventListener('dragstart', (e) => {
                        e.dataTransfer?.setData('text/plain', child.path);
                    });
                }

                fileEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.app.workspace.getLeaf().openFile(child);
                });

                fileEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showFileContextMenu(e, child);
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
            await this.plugin.saveData(this.plugin.settings);
        });
    }

    private sortFolderChildren(children: any[]): any[] {
        const folders = children.filter(c => c instanceof TFolder);
        const files = children.filter(c => c instanceof TFile);

        // Folders are always sorted by name (ignoring sort settings)
        folders.sort((a, b) => a.name.localeCompare(b.name));

        // Files are sorted according to user settings
        const fileSortFunc = (a: TFile, b: TFile) => {
            let aVal: any, bVal: any;
            switch (this.plugin.settings.sortBy) {
                case 'name':
                    aVal = a.name;
                    bVal = b.name;
                    break;
                case 'created':
                    aVal = a.stat.ctime;
                    bVal = b.stat.ctime;
                    break;
                case 'modified':
                    aVal = a.stat.mtime;
                    bVal = b.stat.mtime;
                    break;
                default:
                    aVal = a.name;
                    bVal = b.name;
            }
            if (this.plugin.settings.sortOrder === 'asc') {
                if (aVal < bVal) return -1;
                if (aVal > bVal) return 1;
                return 0;
            } else {
                if (aVal > bVal) return -1;
                if (aVal < bVal) return 1;
                return 0;
            }
        };
        files.sort(fileSortFunc);

        return [...folders, ...files];
    }
}