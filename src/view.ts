import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu, Notice, Modal, App, Platform, setIcon, Component } from 'obsidian';
import PortalsPlugin from './main';
import Sortable, { SortableEvent } from 'sortablejs';
import { SpaceConfig } from './settings';
import { MarkdownRenderer } from 'obsidian';

const MIN_EXPANDED_HEIGHT = 150;
const SIDE_TAB_ICONS: Record<string, string> = {
    recent: 'clock-counter-clockwise',
    'folder-notes': 'note',
    bookmarks: 'bookmark'
};

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
    private renaming: boolean = false;
    private selectedFiles: Set<string> = new Set();
    private isDraggingSplitter: boolean = false;
    private currentSecondaryPanel: HTMLElement | null = null;
    private currentSplitter: HTMLElement | null = null;
    private sortableInstance: Sortable | null = null;

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


        this.registerEvent(this.app.workspace.on('file-open', () => {
            if (!this.renaming) this.renderContent();
        }));
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            if (!this.renaming) this.renderContent();
        }));

        // Try to listen directly to the bookmarks plugin
        const bookmarksPlugin = (this.app as any).internalPlugins?.getPluginById('bookmarks');
        let bookmarksPluginRef: any = null;
        if (bookmarksPlugin?.instance && typeof bookmarksPlugin.instance.on === 'function') {
            bookmarksPluginRef = bookmarksPlugin.instance.on('changed', () => {
                console.log('bookmarks plugin changed event fired');
                const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
                if (secondaryPanel) {
                    const contentEl = secondaryPanel.querySelector('.portals-split-content');
                    if (contentEl) {
                        (contentEl as HTMLElement).empty();
                        this.renderBookmarksTab(contentEl as HTMLElement);
                    }
                }
            });
            // Store it to unregister later
            (this as any).bookmarksPluginRef = bookmarksPluginRef;
        }

        //---FolderNotes 
        const refreshFolderNotes = () => {
            if (this.plugin.settings.activeSplitTab === 'folder-notes') {
                const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
                if (secondaryPanel) {
                    const contentEl = secondaryPanel.querySelector('.portals-split-content');
                    if (contentEl) {
                        (contentEl as HTMLElement).empty();
                        this.renderFolderNotesTab(contentEl as HTMLElement);
                    }
                }
            }
        };
        const folderNoteRenameRef = this.app.vault.on('rename', refreshFolderNotes);
        const folderNoteDeleteRef = this.app.vault.on('delete', refreshFolderNotes);
        const folderNoteCreateRef = this.app.vault.on('create', refreshFolderNotes);
        (this as any).folderNoteEventRefs = [folderNoteRenameRef, folderNoteDeleteRef, folderNoteCreateRef];


        // Global drag listeners
        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('touchmove', this.handleDragMove, { passive: false });
        document.addEventListener('mouseup', this.handleDragEnd);
        document.addEventListener('touchend', this.handleDragEnd);
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
        
        //--clean up foldernotes listeners
        if ((this as any).folderNoteEventRefs) {
            (this as any).folderNoteEventRefs.forEach((ref:any) => this.app.vault.offref(ref));
            (this as any).folderNoteEventRefs = null;
        }

        // Clean up bookmarks plugin listener if we added one
        const bookmarksPluginRef = (this as any).bookmarksPluginRef;
            if (bookmarksPluginRef) {
                const bookmarksPlugin = (this.app as any).internalPlugins?.getPluginById('bookmarks');
                if (bookmarksPlugin?.instance && typeof bookmarksPlugin.instance.off === 'function') {
                    bookmarksPlugin.instance.off('changed', bookmarksPluginRef);
                }
            }

        document.removeEventListener('mousemove', this.handleDragMove);
        document.removeEventListener('touchmove', this.handleDragMove);
        document.removeEventListener('mouseup', this.handleDragEnd);
        document.removeEventListener('touchend', this.handleDragEnd);
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
        if (this.tooltipTimeout) {
            window.clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
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

    //-- New Drag Handler

    private handleDragStart = (e: MouseEvent | TouchEvent) => {
        if (!this.plugin.settings.sidePanelEnabled) return;
        this.isDraggingSplitter = true;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    };

    private handleDragMove = (e: MouseEvent | TouchEvent) => {
        if (!this.isDraggingSplitter || !this.currentSecondaryPanel || !this.currentSplitter || !this.plugin.settings.sidePanelEnabled) return;

        e.preventDefault();

        const splitContainer = this.currentSecondaryPanel.parentElement?.parentElement;
        if (!splitContainer) return;

        const rect = splitContainer.getBoundingClientRect();
        let clientY: number;

        if (e instanceof TouchEvent) {
            const touch = e.touches[0];
            if (!touch) return; // no touch point – abort
            clientY = touch.clientY;
        } else {
            clientY = e.clientY;
        }

        const relativeY = clientY - rect.top;
        const minHeight = 50;
        const maxHeight = rect.height - 50;
        let newHeight = Math.min(maxHeight, Math.max(minHeight, rect.height - relativeY));

        this.currentSecondaryPanel.style.height = newHeight + 'px';
        const splitContent = this.currentSecondaryPanel.querySelector('.portals-split-content') as HTMLElement;
        if (splitContent) splitContent.style.display = 'block';
        if (this.currentSplitter) this.currentSplitter.style.display = 'block';

        // update lastExpanded height only above collapse threshold
        const COLLAPSE_THRESHOLD = 80;
        if (!this.plugin.settings.secondaryPanelCollapsed && newHeight > COLLAPSE_THRESHOLD) {
            this.plugin.settings.lastExpandedHeight = newHeight;
        }
       

        this.plugin.settings.secondaryPanelHeight = newHeight;
        this.plugin.settings.secondaryPanelCollapsed = false;
        this.currentSecondaryPanel.classList.remove('is-collapsed');
        const collapseIcon = this.currentSecondaryPanel.querySelector('.portals-collapse-icon');
        if (collapseIcon) collapseIcon.innerHTML = '▼';
        this.plugin.saveData(this.plugin.settings);
    };

    private handleDragEnd = (e: MouseEvent | TouchEvent) => {
        if (this.isDraggingSplitter) {
            this.isDraggingSplitter = false;
            document.body.style.cursor = '';

            // Snap‑to‑collapse: if dragged almost to the bottom, collapse
            if (this.currentSecondaryPanel) {
                const height = parseFloat(this.currentSecondaryPanel.style.height);
                const minHeight = 50;
                if (height <= minHeight + 10) {
                    this.plugin.settings.secondaryPanelCollapsed = true;
                    this.currentSecondaryPanel.classList.add('is-collapsed');
                    this.currentSecondaryPanel.style.borderTop = '';
                    this.currentSecondaryPanel.style.height = '42px';
                    const splitContent = this.currentSecondaryPanel.querySelector('.portals-split-content') as HTMLElement;
                    if (splitContent) splitContent.style.display = 'none';
                    if (this.currentSplitter) this.currentSplitter.style.display = 'none';
                    const collapseIcon = this.currentSecondaryPanel.querySelector('.portals-collapse-icon');
                    if (collapseIcon) collapseIcon.innerHTML = '▲';
                    this.plugin.saveData(this.plugin.settings);
                }
            }
        }
    };

    //-- ExpandPanel Helper

    private expandPanel() {
        if (!this.plugin.settings.sidePanelEnabled) return;
        if (this.plugin.settings.secondaryPanelCollapsed) {
            this.plugin.settings.secondaryPanelCollapsed = false;
            const secondaryPanel = this.currentSecondaryPanel;
            if (secondaryPanel) {
                secondaryPanel.style.height = Math.max(this.plugin.settings.lastExpandedHeight, MIN_EXPANDED_HEIGHT) + 'px';
                const splitContent = secondaryPanel.querySelector('.portals-split-content') as HTMLElement;
                if (splitContent) splitContent.style.display = 'block';
                if (this.currentSplitter) this.currentSplitter.style.display = 'block';
                const collapseIcon = secondaryPanel.querySelector('.portals-collapse-icon');
                if (collapseIcon) collapseIcon.innerHTML = '▼';
                // Remove the collapsed class so CSS can apply the correct border
                secondaryPanel.classList.remove('is-collapsed');
            }
            this.plugin.saveData(this.plugin.settings);
        }
    }

    //-- FolderNote
    private isFolderNote(file: TFile, folder: TFolder): boolean {
        return file.extension === 'md' && file.name.toLowerCase() === (folder.name + '.md').toLowerCase() && file.parent?.path === folder.path;
    }

    //-- Settings Hash
    private getSettingsHash(): string {
        const s = this.plugin.settings;
        return JSON.stringify({
            spaces: s.spaces.map(sp => `${sp.type}:${sp.path}|${sp.icon}|${sp.color}`).join(','),
            openFolders: s.openFolders.join(','),
            selectedSpace: s.selectedSpace ? `${s.selectedSpace.type}:${s.selectedSpace.path}` : '',
            filePaneColorStyle: s.filePaneColorStyle,
            tabColorEnabled: s.tabColorEnabled,
            showInactiveTabNames: s.showInactiveTabNames,
            sortBy: s.sortBy,
            sortOrder: s.sortOrder,
            secondaryPanelCollapsed: s.secondaryPanelCollapsed,
            secondaryPanelHeight: s.secondaryPanelHeight,
            sidePanelEnabled: s.sidePanelEnabled,
            activeSplitTab: s.activeSplitTab,
            splitViewTabs: s.splitViewTabs?.join(',') || '',
            recentFilesList: s.recentFilesList?.join(',') || '',
            showFolderNotesInTree: s.showFolderNotesInTree
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
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.height = '100%';

            const spaces = this.plugin.settings.spaces;

            if (spaces.length === 0) {
                container.createEl('p', { text: 'No portals configured. Add some in settings.' });
                return;
            }

            if (this.sortableInstance) {
                this.sortableInstance.destroy();
                this.sortableInstance = null;
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

                const isActive = (space.path === this.plugin.settings.selectedSpace?.path && space.type === this.plugin.settings.selectedSpace?.type);

                if (isActive) {
                    tab.addClass('is-active');
                    if (space.path !== '/') {
                        tab.createSpan({ text: displayName });
                    }
                } else {
                    if (this.plugin.settings.showInactiveTabNames) {
                        tab.createSpan({ text: displayName })
                    }
                    if (!Platform.isMobile) {
                        tab.addEventListener('mouseenter', () => {
                            this.showTooltip(displayName, tab);
                        });
                        tab.addEventListener('mouseleave', () => {
                            this.hideTooltip(100);
                        });
                    }
                }

                if (this.plugin.settings.tabColorEnabled && space.color && space.color !== 'transparent') {
                    if (isActive) {
                        tab.style.borderBottomColor = space.color;
                    } else {
                        tab.style.borderBottomColor = '';
                    }
                } else {
                    tab.style.borderBottomColor = '';
                }

                tab.style.background = '';
                tab.dataset.path = space.path;
                tab.dataset.type = space.type;

                if (space.icon) {
                    const iconSpan = tab.createSpan({ cls: 'portals-tab-icon' });
                    iconSpan.createEl('i', { cls: `ph ph-${space.icon}` });
                }

                tab.addEventListener('click', async () => {
                    this.hideTooltip(0);
                    this.plugin.settings.selectedSpace = {
                        path: space.path,
                        type: space.type
                    };

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

           this.sortableInstance = new Sortable(tabBar, {
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

            // --- Split pane layout with tabs ---
            const splitContainer = container.createDiv({ cls: 'portals-split-container' });

            // Main panel (folder/tag tree)
            const mainPanel = splitContainer.createDiv({ cls: 'portals-main-panel' });

            // Tree content area (scrollable)
            const treeContainer = mainPanel.createDiv({ cls: 'portals-tree-container' });

            // Splitter (draggable)
            const splitter = splitContainer.createDiv({ cls: 'portals-splitter' });
            this.currentSplitter = splitter;

            // Secondary panel (tabs + content)
            const secondaryPanel = splitContainer.createDiv({ cls: 'portals-secondary-panel' });
            this.currentSecondaryPanel = secondaryPanel;

            // Header with tabs and collapse icon
            const secondaryHeader = secondaryPanel.createDiv({ cls: 'portals-secondary-header' });

            // Tab container
            const tabContainer = secondaryHeader.createDiv({ cls: 'portals-split-tabs' });

           // Get tabs from settings, ensure folder-notes is present for testing
           let tabs = this.plugin.settings.splitViewTabs || ['recent'];
           const icons = SIDE_TAB_ICONS;
           const activeTab = this.plugin.settings.activeSplitTab || 'recent';

           let rootColor: string | undefined;
           if (this.plugin.settings.pinVaultRoot && this.plugin.settings.tabColorEnabled) {
            const rootSpace = spaces.find(s => s.path === '/' && s.type === 'folder');
            if (rootSpace && rootSpace.color && rootSpace.color !== 'transparent') {
                rootColor = rootSpace.color;
            }
           }

            tabs.forEach(tabId => {
                const tabBtn = tabContainer.createEl('div', { cls: 'portals-split-tab' });
                tabBtn.dataset.tabId = tabId;

                const iconName = icons[tabId] || 'file';
                tabBtn.innerHTML = `<i class="ph ph-${iconName}"></i>`;
                if (tabId === activeTab || this.plugin.settings.showInactiveTabNames) {
                    const span = document.createElement('span');
                    span.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1).replace('-', ' ');
                    tabBtn.appendChild(span);
                }

                if (tabId === activeTab) {
                    tabBtn.addClass('is-active');
                    if (rootColor) {
                        tabBtn.style.borderBottomColor = rootColor;
                    }
                }

                tabBtn.addEventListener('click', () => {
                    this.expandPanel();
                    this.plugin.settings.activeSplitTab = tabId;
                    this.plugin.saveData(this.plugin.settings);

                    tabContainer.querySelectorAll('.portals-split-tab').forEach(t => {
                        const tabElements = t as HTMLElement;
                        const tId = tabElements.dataset.tabId;
                        if (!tId) return;
                        const icon = icons[tId] || 'file';
                        tabElements.empty();
                        tabElements.innerHTML = `<i class="ph ph-${icon}"></i>`;
                        if (tId === tabId || this.plugin.settings.showInactiveTabNames) {
                            const span = document.createElement('span');
                            span.textContent = tId.charAt(0).toUpperCase() + tId.slice(1).replace('-', ' ');
                            tabElements.appendChild(span);
                        }
                        tabElements.style.borderBottomColor = '';
                        tabElements.removeClass('is-active');
                    });
                    tabBtn.addClass('is-active');
                    if (rootColor) {
                        tabBtn.style.borderBottomColor = rootColor;
                    }
                    this.renderSplitTabContent(secondaryPanel, tabId);
                });
            });

            // Collapse icon
            const collapseIcon = secondaryHeader.createSpan({ cls: 'portals-collapse-icon' });
            collapseIcon.innerHTML = this.plugin.settings.secondaryPanelCollapsed ? '▲' : '▼';  

            // Content area (collapsible)
            const splitContent = secondaryPanel.createDiv({ cls: 'portals-split-content' });

            // Set initial state
            const isCollapsed = this.plugin.settings.secondaryPanelCollapsed;
            const panelHeight = this.plugin.settings.secondaryPanelHeight || 200;
            if (!this.plugin.settings.sidePanelEnabled) {
                secondaryPanel.style.display = 'none';
                splitter.style.display = 'none';
            } else if (isCollapsed) {
                secondaryPanel.style.height = '42px';
                splitContent.style.display = 'none';
                splitter.style.display = 'none';
                secondaryPanel.classList.add('is-collapsed');
            } else {
                secondaryPanel.style.height = Math.max(this.plugin.settings.lastExpandedHeight, MIN_EXPANDED_HEIGHT) + 'px';
                splitContent.style.display = 'block';
                splitter.style.display = 'block';
                secondaryPanel.classList.remove('is-collapsed');                
            }

            // Toggle collapse on icon click
            collapseIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.plugin.settings.sidePanelEnabled) return;

                const newCollapsed = !this.plugin.settings.secondaryPanelCollapsed;
                this.plugin.settings.secondaryPanelCollapsed = newCollapsed;
                if (newCollapsed) {
                    secondaryPanel.style.height = '42px';
                    splitContent.style.display = 'none';
                    splitter.style.display = 'none';
                    collapseIcon.innerHTML = '▲';
                    secondaryPanel.classList.add('is-collapsed');
                } else {
                    secondaryPanel.style.height = Math.max(this.plugin.settings.lastExpandedHeight, MIN_EXPANDED_HEIGHT) + 'px';
                    splitContent.style.display = 'block';
                    splitter.style.display = 'block';
                    collapseIcon.innerHTML = '▼';
                    secondaryPanel.classList.remove('is-collapsed');
                }
                this.plugin.saveData(this.plugin.settings);
            });

            // Make splitter draggable (mouse + touch)
            splitter.addEventListener('mousedown', this.handleDragStart);
            splitter.addEventListener('touchstart', this.handleDragStart, { passive: false });


            // Initial content
            this.renderSplitTabContent(secondaryPanel, activeTab);

            // Now put the main panel content (folder tree / tag space) inside treeContainer
            const selectedSpace = spaces.find(s => 
                s.path === this.plugin.settings.selectedSpace?.path && 
                s.type === this.plugin.settings.selectedSpace?.type
            ) || spaces[0];
            if (selectedSpace) {
                if (selectedSpace.type === 'folder') {
                    const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
                    if (folder && folder instanceof TFolder) {
                        const spaceContent = treeContainer.createEl('div', { cls: 'portals-space-content' });
                        this.applySpaceBackground(spaceContent, selectedSpace.color);
                        this.makeDropTarget(spaceContent, folder, true);
                        this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
                    } else {
                        treeContainer.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
                    }
                } else {
                    const spaceContent = treeContainer.createEl('div', { cls: 'portals-space-content' });
                    this.applySpaceBackground(spaceContent, selectedSpace.color);
                    this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
                }
            }

            // Floating buttons (attached to mainPanel)
            const createFloatingButton = (icon: string, tooltip: string, bottom: number, onClick: (e: MouseEvent) => void) => {
                const btn = mainPanel.createEl('button', { cls: 'portals-floating-btn' });
                btn.style.bottom = bottom + 'px';
                btn.innerHTML = `<i class="ph ph-${icon}"></i>`;
                if (!Platform.isMobile) {
                    btn.addEventListener('mouseenter', () => this.showTooltip(tooltip, btn));
                    btn.addEventListener('mouseleave', () => this.hideTooltip(100));
                }
                btn.addEventListener('click', onClick);
                return btn;
            };

            createFloatingButton('file-plus', 'New note', 136, async () => {
                const currentSpace = this.plugin.settings.spaces.find(s => 
                    s.path === this.plugin.settings.selectedSpace?.path && 
                    s.type === this.plugin.settings.selectedSpace?.type
                );
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

            createFloatingButton('folder-simple-plus', 'New folder', 94, async () => {
                const currentSpace = this.plugin.settings.spaces.find(s => 
                    s.path === this.plugin.settings.selectedSpace?.path && 
                    s.type === this.plugin.settings.selectedSpace?.type
                );
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

            createFloatingButton('caret-circle-up-down', 'Sort', 52, (e: MouseEvent) => {
                const menu = new Menu();
                const setSort = (by: 'name' | 'created' | 'modified', order: 'asc' | 'desc') => {
                    this.plugin.settings.sortBy = by;
                    this.plugin.settings.sortOrder = order;
                    this.plugin.saveData(this.plugin.settings);
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

            createFloatingButton('stack', 'Collapse all', 10, async () => {
                const currentSpace = this.plugin.settings.selectedSpace;
                if (!currentSpace) return;
                this.plugin.settings.openFolders = [currentSpace.path];
                await this.plugin.saveData(this.plugin.settings);
                this.renderContent();
            });

        } catch (e) {
            console.error('Portals render error:', e);
        }
    }

    private renderSplitTabContent(secondaryPanel: HTMLElement, tabId: string) {
        const contentEl = secondaryPanel.querySelector('.portals-split-content') as HTMLElement;
        if (!contentEl) return;
        contentEl.empty();

        if (tabId === 'recent') {
            const recentFiles = this.plugin.settings.recentFilesList || [];
            const existingRecentFiles = recentFiles
                .map(path => this.app.vault.getAbstractFileByPath(path))
                .filter((file): file is TFile => file instanceof TFile);

            for (const file of existingRecentFiles) {
                const fileEl = contentEl.createDiv({ cls: 'file-item recent-file-item' });
                const iconSpan = fileEl.createSpan({ cls: 'file-icon' });
                iconSpan.createEl('i', { cls: 'ph ph-file' });
                const nameSpan = fileEl.createSpan({ text: this.getDisplayName(file) });
                nameSpan.addClass('portals-item-name');
                fileEl.dataset.path = file.path;

                fileEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.app.workspace.getLeaf().openFile(file);
                });

                fileEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showFileContextMenu(e, file, fileEl);
                });
            }

        } else if (tabId === 'folder-notes') {
            this.renderFolderNotesTab(contentEl)
        }
    }

    // Bookmarks

    private renderBookmarksTab(contentEl: HTMLElement) {
    const bookmarksPlugin = (this.app as any).internalPlugins?.getPluginById('bookmarks');
    if (!bookmarksPlugin || !bookmarksPlugin.enabled) {
        contentEl.createEl('p', { text: 'The Bookmarks core plugin is not enabled. Settings → Core plugins.' });
        return;
    }

    if (!bookmarksPlugin.instance) {
        contentEl.createEl('p', { text: 'Bookmarks plugin instance not found. Restart Obsidian' });
        return;
    }

    const items = bookmarksPlugin.instance?.items;
    if (!items || !Array.isArray(items)) {
        contentEl.createEl('p', { text: 'No bookmarks found.' });
        return;
    }

    // Helper to refresh the bookmarks tab after deletion
    const refreshBookmarksTab = () => {
        const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
        if (secondaryPanel) {
            this.renderSplitTabContent(secondaryPanel as HTMLElement, 'bookmarks');
        }
    };

    // Helper to delete a bookmark item
    const deleteBookmark = (itemToDelete: any) => {
        // Try different deletion methods
        if (typeof bookmarksPlugin.instance?.removeItem === 'function') {
            bookmarksPlugin.instance.removeItem(itemToDelete);
        } else if (typeof bookmarksPlugin.instance?.delete === 'function') {
            bookmarksPlugin.instance.delete(itemToDelete);
        } else if (itemToDelete.id && typeof bookmarksPlugin.instance?.deleteItem === 'function') {
            bookmarksPlugin.instance.deleteItem(itemToDelete.id);
        } 
        refreshBookmarksTab();
    };

    // Recursive render function
    const renderItem = (item: any, container: HTMLElement) => {
        if (item.children && Array.isArray(item.children) && item.children.length > 0) {
            // It's a group/folder
            const details = container.createEl('details', { cls: 'folder-details' });
            details.setAttr('open', 'true');
            const summary = details.createEl('summary', { cls: 'folder-summary' });
            const iconSpan = summary.createSpan({ cls: 'folder-icon' });
            iconSpan.createEl('i', { cls: 'ph ph-folder' });
            const nameSpan = summary.createSpan({ text: item.title || 'Group' });
            nameSpan.addClass('portals-item-name');

            // Context menu on group summary
            summary.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = new Menu();
                menu.addItem(menuItem => menuItem
                    .setTitle('Delete group')
                    .setIcon('trash')
                    .onClick(() => {
                        if (confirm(`Delete bookmark group "${item.title || 'Group'}"?`)) {
                            deleteBookmark(item);
                        }
                    })
                );
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });

            const childrenContainer = details.createDiv({ cls: 'folder-children' });
            item.children.forEach((child: any) => renderItem(child, childrenContainer));
        } else {
            // Leaf item: file, url, or folder (without children)
            const fileEl = container.createDiv({ cls: 'file-item' });
            const iconSpan = fileEl.createSpan({ cls: 'file-icon' });

            let iconClass = 'ph-file';
            if (item.type === 'url') iconClass = 'ph-link';
            else if (item.type === 'folder') iconClass = 'ph-folder';
            else if (item.type === 'file') iconClass = 'ph-file';
            else if (item.url) iconClass = 'ph-link';
            else if (item.path) {
                const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
                if (abstractFile instanceof TFolder) iconClass = 'ph-folder';
                else iconClass = 'ph-file';
            }

            iconSpan.createEl('i', { cls: `ph ${iconClass}` });

            const displayName = item.title || item.path || item.url || 'Untitled';
            const nameSpan = fileEl.createSpan({ text: displayName });
            nameSpan.addClass('portals-item-name');
            fileEl.dataset.path = item.path || item.url;

            // Left‑click to open
            fileEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.type === 'url' || item.url) {
                    window.open(item.url || item.path, '_blank');
                } else if (item.type === 'file' || item.path) {
                    const file = this.app.vault.getAbstractFileByPath(item.path);
                    if (file instanceof TFile) {
                        this.app.workspace.getLeaf().openFile(file);
                    } else if (file instanceof TFolder) {
                        this.app.workspace.openLinkText(item.path, '/', false);
                    }
                } else if (item.type === 'folder') {
                    this.app.workspace.openLinkText(item.path, '/', false);
                }
            });

            // Right‑click context menu for deletion
            fileEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = new Menu();
                menu.addItem(menuItem => menuItem
                    .setTitle('Delete bookmark')
                    .setIcon('trash')
                    .onClick(() => {
                        if (confirm(`Delete bookmark "${displayName}"?`)) {
                            deleteBookmark(item);
                        }
                    })
                );
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });
        }
    };

    items.forEach((item: any) => renderItem(item, contentEl));
}

    // End of bookmark

    // Folder note

    private async createFolderNote(folder: TFolder) {
        const noteName = folder.name + '.md';
        const notePath = `${folder.path}/${noteName}`;
        try {
            const file = await this.app.vault.create(notePath, `# ${folder.name}\n\n`);
            await this.app.workspace.getLeaf().openFile(file);
            // Optionally refresh the side portal tab if it's active
            if (this.plugin.settings.activeSplitTab === 'folder-notes') {
                const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
                if (secondaryPanel) {
                    const contentEl = secondaryPanel.querySelector('.portals-split-content');
                    if (contentEl) {
                        (contentEl as HTMLElement).empty();
                        this.renderFolderNotesTab(contentEl as HTMLElement);
                    }
                }
            }
        } catch (err) {
            new Notice(`Failed to create folder note: ${err}`);
        }
    }

    //--RenderFolderNotesTab
    
    private renderFolderNotesTab(contentEl: HTMLElement) {
        const selectedSpace = this.plugin.settings.selectedSpace;
        if (!selectedSpace || selectedSpace.type !== 'folder') {
            contentEl.createEl('p', { text: 'Select a folder space to view its folder note.' });
            return;
        }
        const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
        if (!(folder instanceof TFolder)) {
            contentEl.createEl('p', { text: 'Folder not found.' });
            return;
        }
        const folderNote = folder.children.find((child): child is TFile => 
            child instanceof TFile && this.isFolderNote(child, folder)
        );
        console.log('Folder note found:', folderNote ? folderNote.path : 'none');

        if (!folderNote) {
            contentEl.createEl('p', { text: 'No folder note found for this folder. Create one using the folder context menu.' });
            return;
        }

        const noteContainer = contentEl.createDiv({ cls: 'markdown-reading-view' });
        noteContainer.style.padding = '8px';
        noteContainer.style.height = '100%';
        noteContainer.style.overflowY = 'auto';
        noteContainer.style.cursor = 'pointer';

        // Read and render the note
        this.app.vault.read(folderNote).then(content => {
            try {
                const component = new Component();
                // Cast MarkdownRenderer to any to bypass type errors
                (MarkdownRenderer as any).renderMarkdown(
                    content,
                    noteContainer,
                    folderNote.path,
                    component
                );
                // Register the component for cleanup
                this.addChild(component);
            } catch (e) {
                console.error('Error rendering folder note:', e);
                noteContainer.setText('Error rendering note.');
            }
        }).catch(e => {
            console.error('Error reading folder note:', e);
            noteContainer.setText('Error reading note.');
        });

        // Click to open (but not on links)
        noteContainer.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('a')) return;
            this.app.workspace.getLeaf().openFile(folderNote);
        });
    }

    //--End of renderFolderNotesTab


    async renderContent() {
        const container = this.containerEl.children[1] as HTMLElement;
        const treeContainer = container.querySelector('.portals-tree-container');
        if (!treeContainer) return;
        treeContainer.empty();

        const spaces = this.plugin.settings.spaces;
        const selectedSpace = spaces.find(s => 
            s.path === this.plugin.settings.selectedSpace?.path && 
            s.type === this.plugin.settings.selectedSpace?.type
        ) || spaces[0];
        if (!selectedSpace) return;

        if (selectedSpace.type === 'folder') {
            const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
            if (folder && folder instanceof TFolder) {
                const spaceContent = treeContainer.createEl('div', { cls: 'portals-space-content' });
                this.applySpaceBackground(spaceContent, selectedSpace.color);
                this.makeDropTarget(spaceContent, folder, true);
                this.buildFolderTree(folder, spaceContent, selectedSpace.icon);
            } else {
                treeContainer.createEl('p', { text: `Folder not found: ${selectedSpace.path}` });
            }
        } else {
            const spaceContent = treeContainer.createEl('div', { cls: 'portals-space-content' });
            this.applySpaceBackground(spaceContent, selectedSpace.color);
            this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon);
        }
    }

    public refreshRecentTab() {
        const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
        if (!secondaryPanel) return;
        const activeTab = this.plugin.settings.activeSplitTab;
        if (activeTab === 'recent') {
            this.renderSplitTabContent(secondaryPanel as HTMLElement, 'recent');
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

        const sortBy = this.plugin.settings.sortBy;
        const sortOrder = this.plugin.settings.sortOrder;
        taggedFiles.sort((a: TFile, b: TFile) => {
            let aVal: any, bVal: any;
            switch (sortBy) {
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
            if (sortOrder === 'asc') {
                if (aVal < bVal) return -1;
                if (aVal > bVal) return 1;
                return 0;
            } else {
                if (aVal > bVal) return -1;
                if (aVal < bVal) return 1;
                return 0;
            }
        });

        if (taggedFiles.length === 0) {
            container.createEl('p', { text: 'No files with this tag.' });
            return;
        }

        const details = container.createEl('details', { cls: 'folder-details' });
        details.setAttr('open', 'true');

        const summary = details.createEl('summary', { cls: 'folder-summary' });
        const iconSpan = summary.createSpan({ cls: 'folder-icon' });
        iconSpan.createEl('i', { cls: `ph ph-${iconName || 'tag'}` });
        const nameSpan = summary.createSpan({ text: '#' + tagName });
        nameSpan.addClass('portals-item-name');

        const childrenContainer = details.createDiv({ cls: 'folder-children' });

        for (const file of taggedFiles) {
            const fileEl = childrenContainer.createDiv({ cls: 'file-item' });
            const fileIcon = fileEl.createSpan({ cls: 'file-icon' });
            fileIcon.createEl('i', { cls: 'ph ph-file' });
            const nameSpan = fileEl.createSpan({ text: this.getDisplayName(file) });
            nameSpan.addClass('portals-item-name');

            fileEl.dataset.path = file.path;

            if (this.isFileOpen(file)) {
                fileEl.createSpan({ cls: 'open-dot' });
            }

            if (!Platform.isMobile) {
                fileEl.draggable = true;
                fileEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', file.path);
                });
            }

            fileEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.altKey) {
                    e.preventDefault();
                    if (this.selectedFiles.has(file.path)) {
                        this.selectedFiles.delete(file.path);
                        fileEl.removeClass('is-selected');
                    } else {
                        this.selectedFiles.add(file.path);
                        fileEl.addClass('is-selected');
                    }
                } else {
                    this.app.workspace.getLeaf().openFile(file);
                }
            });

            fileEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showFileContextMenu(e, file, fileEl);
            });
        }
    }

    private showFileContextMenu(event: MouseEvent, file: TFile, fileEl: HTMLElement) {
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
            .onClick(() => this.startRenameFile(file, fileEl)));

        menu.addItem(item => item
            .setTitle('Delete')
            .setIcon('trash')
            .onClick(() => this.deleteFile(file)));

        menu.addSeparator();

        this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private showFolderContextMenu(event: MouseEvent, folder: TFolder, summaryEl: HTMLElement) {
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

        const folderNote = folder.children.find((child): child is TFile =>
            child instanceof TFile && this.isFolderNote(child, folder));
        if (folderNote) {
            menu.addItem(item => item
                .setTitle('Open folder note')
                .setIcon('note')
                .onClick(() => this.app.workspace.getLeaf().openFile(folderNote)));
        } else {
            menu.addItem(item => item
                .setTitle('Create folder note')
                .setIcon('plus')
                .onClick(() => this.createFolderNote(folder)));
        }

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle('Duplicate')
            .setIcon('copy')
            .onClick(() => this.executeCommand('file-explorer:copy-folder')));

        menu.addItem(item => item
            .setTitle('Rename')
            .setIcon('pencil')
            .onClick(() => this.startRenameFolder(folder, summaryEl)));

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

    private createRenameInput(initialValue: string, onSave: (val: string) => void, onCancel: () => void): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initialValue;
        input.style.flex = '1';
        input.style.minWidth = '0';
        input.style.padding = '2px 4px';
        input.style.font = 'inherit';
        input.style.color = 'inherit';
        input.style.background = 'var(--background-primary)';
        input.style.border = '1px solid var(--interactive-accent)';
        input.style.borderRadius = '4px';
        input.style.boxShadow = 'none';
        input.style.outline = 'none';
        input.style.margin = '0';
        input.style.boxSizing = 'border-box';

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onSave(input.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        });
        return input;
    }

    private startRenameFile(file: TFile, fileEl: HTMLElement) {
        const nameSpan = fileEl.querySelector('.portals-item-name') as HTMLElement;
        if (!nameSpan) return;

        const isMd = file.extension === 'md';
        const base = isMd ? file.basename : file.name;

        const input = this.createRenameInput(base, async (newBase) => {
            if (!newBase || newBase === base) return;
            const newName = isMd ? newBase + '.' + file.extension : newBase;
            const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
            try {
                await this.app.vault.rename(file, newPath);
                new Notice('File renamed');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Rename failed: ${message}`);
            } finally {
                this.renaming = false;
                document.removeEventListener('mousedown', outsideClickListener);
                this.renderContent();
            }
        }, () => {
            this.renaming = false;
            document.removeEventListener('mousedown', outsideClickListener);
            this.renderContent();
        });

        input.style.flex = '1';
        input.style.minWidth = '0';

        nameSpan.replaceWith(input);
        input.focus();
        input.select();
        this.renaming = true;

        const outsideClickListener = (e: MouseEvent) => {
            if (!input.contains(e.target as Node)) {
                document.removeEventListener('mousedown', outsideClickListener);
                this.renaming = false;
                this.renderContent();
            }
        };
        document.addEventListener('mousedown', outsideClickListener);
    }

    private startRenameFolder(folder: TFolder, summaryEl: HTMLElement) {
        const nameSpan = summaryEl.querySelector('.portals-item-name') as HTMLElement;
        if (!nameSpan) return;

        const input = this.createRenameInput(folder.name, async (newName) => {
            if (!newName || newName === folder.name) return;
            const parent = folder.parent?.path || '';
            const newPath = parent ? `${parent}/${newName}` : newName;
            try {
                await this.app.vault.rename(folder, newPath);
                new Notice('Folder renamed');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Rename failed: ${message}`);
            } finally {
                this.renaming = false;
                document.removeEventListener('mousedown', outsideClickListener);
                this.renderContent();
            }
        }, () => {
            this.renaming = false;
            document.removeEventListener('mousedown', outsideClickListener);
            this.renderContent();
        });

        input.style.flex = '1';
        input.style.minWidth = '0';

        nameSpan.replaceWith(input);
        input.focus();
        input.select();
        this.renaming = true;

        const outsideClickListener = (e: MouseEvent) => {
            if (!input.contains(e.target as Node)) {
                document.removeEventListener('mousedown', outsideClickListener);
                this.renaming = false;
                this.renderContent();
            }
        };
        document.addEventListener('mousedown', outsideClickListener);
    }

    private scrollToAndHighlight(path: string) {
        setTimeout(() => {
            const item = this.containerEl.querySelector(`[data-path="${path}"]`);
            if (item) {
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                item.addClass('portals-item-highlight');
                setTimeout(() => item.removeClass('portals-item-highlight'), 2000);
            }
        }, 100);
    }

    private async triggerRenameOnPath(path: string) {
        this.scrollToAndHighlight(path);
        setTimeout(() => {
            const item = this.containerEl.querySelector(`[data-path="${path}"]`);
            if (!item) return;
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (abstractFile instanceof TFile) {
                this.startRenameFile(abstractFile, item as HTMLElement);
            } else if (abstractFile instanceof TFolder) {
                this.startRenameFolder(abstractFile, item as HTMLElement);
            }
        }, 200);
    }

    private isFileOpen(file: TFile): boolean {
        const viewTypes = ['markdown', 'canvas', 'image', 'pdf', 'audio', 'video', 'bases', 'fountain', 'excalidraw'];

        for (const type of viewTypes) {
            const leaves = this.app.workspace.getLeavesOfType(type);
            const found = leaves.some(leaf => {
                const view = leaf.view;
                return view && (view as any).file && (view as any).file.path === file.path;
            });
            if (found) return true;
        }
        return false;
    }

    private getActiveFilePath(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? activeFile.path : null;
    }

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
        const basePath = folder.path === '/' ? '' : folder.path;
        let candidate = basePath ? `${basePath}/${defaultName}` : defaultName;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = basePath ? `${basePath}/Untitled ${counter}.md` : `Untitled ${counter}.md`;
            counter++;
        }
        try {
            const newFile = await this.app.vault.create(candidate, '');
            await this.app.workspace.getLeaf().openFile(newFile);

            if (!this.plugin.settings.openFolders.includes(folder.path)) {
                this.plugin.settings.openFolders.push(folder.path);
                await this.plugin.saveData(this.plugin.settings);
            }

            await this.renderContent();
            this.triggerRenameOnPath(newFile.path);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create note: ${message}`);
        }
    }

    private async newFolderInFolder(parent: TFolder) {
        const defaultName = 'New Folder';
        const basePath = parent.path === '/' ? '' : parent.path;
        let candidate = basePath ? `${basePath}/${defaultName}` : defaultName;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = basePath ? `${basePath}/New Folder ${counter}` : `New Folder ${counter}`;
            counter++;
        }
        try {
            await this.app.vault.createFolder(candidate);

            if (!this.plugin.settings.openFolders.includes(parent.path)) {
                this.plugin.settings.openFolders.push(parent.path);
                await this.plugin.saveData(this.plugin.settings);
            }

            await this.renderContent();
            this.triggerRenameOnPath(candidate);
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
        const nameSpan = summary.createSpan({ text: displayName });
        nameSpan.addClass('portals-item-name');
        summary.dataset.path = folder.path;

        const activePath = this.getActiveFilePath();
        if (activePath) {
            const isAncestor = folder.path === '/' ? true : activePath.startsWith(folder.path + '/');
            if (isAncestor) {
                summary.createSpan({ cls: 'open-dot' });
            }
        }

        if (!Platform.isMobile) {
            summary.draggable = true;
            summary.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', folder.path);
            });
        }

        this.makeDropTarget(summary, folder, true);

        summary.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showFolderContextMenu(e, folder, summary);
        });

        const childrenContainer = details.createDiv({ cls: 'folder-children' });

        const loadChildren = () => {
            if (childrenContainer.children.length > 0) return;

            const sorted = this.sortFolderChildren(Array.from(folder.children));

            for (const child of sorted) {
                if (child instanceof TFolder) {
                    this.buildFolderTree(child, childrenContainer, 'folder');
                } else if (child instanceof TFile) {
                    if (!this.plugin.settings.showFolderNotesInTree && this.isFolderNote(child, folder)) {
                        continue;
                    }
                    const fileEl = childrenContainer.createDiv({ cls: 'file-item' });
                    const fileIcon = fileEl.createSpan({ cls: 'file-icon' });
                    fileIcon.createEl('i', { cls: 'ph ph-file' });
                    const nameSpan = fileEl.createSpan({ text: this.getDisplayName(child) });
                    nameSpan.addClass('portals-item-name');
                    fileEl.dataset.path = child.path;

                    if (this.isFileOpen(child)) {
                        fileEl.createSpan({ cls: 'open-dot' });
                    }

                    if (!Platform.isMobile) {
                        fileEl.draggable = true;
                        fileEl.addEventListener('dragstart', (e) => {
                            e.dataTransfer?.setData('text/plain', child.path);
                        });
                    }

                    fileEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (e.altKey) {
                            e.preventDefault();
                            if (this.selectedFiles.has(child.path)) {
                                this.selectedFiles.delete(child.path);
                                fileEl.removeClass('is-selected');
                            } else {
                                this.selectedFiles.add(child.path);
                                fileEl.addClass('is-selected');
                            }
                        } else {
                            this.app.workspace.getLeaf().openFile(child);
                        }
                    });

                    fileEl.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        this.showFileContextMenu(e, child, fileEl);
                    });
                }
            }
        };

        if (details.open) {
            loadChildren();
        }

        details.addEventListener('toggle', () => {
            if (details.open) {
                loadChildren();
            }
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
            this.plugin.saveData(this.plugin.settings);
        });
    }

    private sortFolderChildren(children: any[]): any[] {
        const folders = children.filter(c => c instanceof TFolder);
        const files = children.filter(c => c instanceof TFile);

        folders.sort((a, b) => a.name.localeCompare(b.name));

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