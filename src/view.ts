import { ItemView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Menu, Notice, Platform, Component } from 'obsidian';
import PortalsPlugin from './main';
import Sortable, { SortableEvent } from 'sortablejs';
import { SpaceConfig } from './settings';
import { MarkdownRenderer } from 'obsidian';
import { GroupTagsModal } from './settings'


interface BookmarkItem {
    title?: string;
    path?: string;
    url?: string;
    type?: string;
    id?: string;
    children?: BookmarkItem[];
}

const MIN_EXPANDED_HEIGHT = 150;
const SIDE_TAB_ICONS: Record<string, string> = {
    recent: 'clock-counter-clockwise',
    'folder-notes': 'note',
    bookmarks: 'bookmark'
};

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
    private folderNoteEventRefs: Array<unknown> | null = null;
    private bookmarksListenerRef: unknown = null;
    private toggleFloatingButtonsCollapse(e: MouseEvent) {
        console.log('toggle called, current collapsed:', this.plugin.settings.floatingButtonsCollapsed);
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.blur();
        this.plugin.settings.floatingButtonsCollapsed = !this.plugin.settings.floatingButtonsCollapsed;
        void this.plugin.saveData(this.plugin.settings).then(() => {
            console.log('saved, new collapsed:', this.plugin.settings.floatingButtonsCollapsed);
            this.render();
        });
    }

    private collapseAllFolders() {
        (async () => {
            const currentSpace = this.plugin.settings.selectedSpace;
            if (!currentSpace) return;

            if (currentSpace.type === 'folder') {
            this.plugin.settings.openFolders = [currentSpace.path];
            await this.plugin.saveData(this.plugin.settings);
            this.renderContent();
        } else if (currentSpace.type === 'tag') {
            const spaceContent = this.containerEl.querySelector('.portals-space-content');
            if (spaceContent) {
                const allDetails =spaceContent.querySelectorAll('details')
                for (let i = 1; i < allDetails.length; i++) {
                    (allDetails[i] as HTMLDetailsElement).open =false;
                }
            }
        }
        })().catch(err => console.error('Error collapsing folders:', err));
    }

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

        // Set up bookmarks change listener (using internal plugin for now)
        const setupBookmarksListener = () => {
            // @ts-expect-error - accessing internal plugin API
            const bookmarksPlugin = this.app.internalPlugins?.getPluginById('bookmarks');
            if (bookmarksPlugin?.instance && typeof bookmarksPlugin.instance.on === 'function') {
                const ref = bookmarksPlugin.instance.on('changed', () => {
                    const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
                    if (secondaryPanel) {
                        const contentEl = secondaryPanel.querySelector('.portals-split-content');
                        if (contentEl) {
                            (contentEl as HTMLElement).empty();
                            this.renderBookmarksTab(contentEl as HTMLElement);
                        }
                    }
                });
                // Store ref for cleanup
                this.bookmarksListenerRef = ref;
            }
        };
        setupBookmarksListener();


        //---FolderNotes 
        const refreshFolderNotes = () => {
            if (!this.plugin.settings.enableFolderNotes) return;
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
        this.folderNoteEventRefs = [folderNoteRenameRef, folderNoteDeleteRef, folderNoteCreateRef];

        // Global drag listeners
        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('touchmove', this.handleDragMove, { passive: false });
        document.addEventListener('mouseup', this.handleDragEnd);
        document.addEventListener('touchend', this.handleDragEnd);
        await Promise.resolve()
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

        if (this.sortableInstance) {
            this.sortableInstance.destroy();
            this.sortableInstance = null;
        }
        
        //--clean up foldernotes listeners
        if (this.folderNoteEventRefs) {
            this.folderNoteEventRefs.forEach((ref) => {
                // @ts-expect-error - ref is an EventRef, but Typsescript doesn't know
                this.app.vault.offref(ref);
            });
            this.folderNoteEventRefs = null;
        }

        // Clean up bookmarks listener
        const ref = this.bookmarksListenerRef;
        if (ref) {
            // @ts-expect-error - accessing internal plugin API
            const bookmarksPlugin = this.app.internalPlugins?.getPluginById('bookmarks');
            if (bookmarksPlugin?.instance && typeof bookmarksPlugin.instance.off === 'function') {
                bookmarksPlugin.instance.off('changed', ref);
            }
            this.bookmarksListenerRef = null;
        }

        document.removeEventListener('mousemove', this.handleDragMove);
        document.removeEventListener('touchmove', this.handleDragMove);
        document.removeEventListener('mouseup', this.handleDragEnd);
        document.removeEventListener('touchend', this.handleDragEnd);

        await Promise.resolve();
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
        tooltip.classList.add('is-visible');

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
                const tooltip = this.getTooltipEl();
                tooltip.classList.remove('is-visible');
            }, delay);
        } else {
            const tooltip = this.getTooltipEl();
            tooltip.classList.remove('is-visible');
        }
    }

    //-- New Drag Handler

    private handleDragStart = (e: MouseEvent | TouchEvent) => {
        if (!this.plugin.settings.sidePanelEnabled) return;
        this.isDraggingSplitter = true;
        document.body.classList.add('portals-dragging');
        e.preventDefault();
    };

    private dragMoveRaf: number | null = null;
    private lastClientY = 0;
    private lastRect: DOMRect | null = null;

    private handleDragMove = (e: MouseEvent | TouchEvent) => {
        if (!this.isDraggingSplitter || !this.plugin.settings.sidePanelEnabled) return;
        e.preventDefault();

        const secondaryPanel = this.currentSecondaryPanel;
        const splitter = this.currentSplitter;
        if (!secondaryPanel || !splitter) return;

        const splitContainer = secondaryPanel.parentElement?.parentElement;
        if (!splitContainer) return;

        const rect = splitContainer.getBoundingClientRect();
        const clientY = e instanceof TouchEvent ? e.touches[0]?.clientY : e.clientY;
        if (clientY === undefined) return;

        // --- Synchronous height update (immediate feedback) ---
        const relativeY = clientY - rect.top;
        const minHeight = 50;
        const maxHeight = rect.height - 50;
        const newHeight = Math.min(maxHeight, Math.max(minHeight, rect.height - relativeY));
        secondaryPanel.style.height = newHeight + 'px';
        splitter.classList.remove('is-hidden');

        // --- Throttle the rest (settings updates) ---
        // Store latest data for the RAF callback
        this.lastClientY = clientY;
        this.lastRect = rect;

        if (this.dragMoveRaf) return; // already scheduled

        this.dragMoveRaf = requestAnimationFrame(() => {
            this.dragMoveRaf = null;
            if (!secondaryPanel || !splitContainer) return;

            // Use stored data to update non‑critical settings
            const COLLAPSE_THRESHOLD = 80;
            const currentHeight = parseFloat(secondaryPanel.style.height); // read actual height
            if (!this.plugin.settings.secondaryPanelCollapsed && currentHeight > COLLAPSE_THRESHOLD) {
                this.plugin.settings.lastExpandedHeight = currentHeight;
            }
            this.plugin.settings.secondaryPanelHeight = currentHeight;
            this.plugin.settings.secondaryPanelCollapsed = false;
            secondaryPanel.classList.remove('is-collapsed');
            const collapseIcon = secondaryPanel.querySelector('.portals-collapse-icon');
            if (collapseIcon) collapseIcon.textContent = '▼';
        });
    };  

    private handleDragEnd = (e: MouseEvent | TouchEvent) => {
        if (this.dragMoveRaf) {
            cancelAnimationFrame(this.dragMoveRaf);
            this.dragMoveRaf = null;
        }
        if (this.isDraggingSplitter) {
            this.isDraggingSplitter = false;
            document.body.classList.remove('portals-dragging');

            if (this.currentSecondaryPanel) {
                const height = parseFloat(this.currentSecondaryPanel.style.height);
                const minHeight = 50;
                if (height <= minHeight + 10) {
                    this.plugin.settings.secondaryPanelCollapsed = true;
                    this.currentSecondaryPanel.classList.add('is-collapsed');
                    this.currentSecondaryPanel.style.height = '42px';
                    if (this.currentSplitter) {
                        this.currentSplitter?.classList.add('is-hidden');
                    }
                    const collapseIcon = this.currentSecondaryPanel.querySelector('.portals-collapse-icon');
                    if (collapseIcon) collapseIcon.textContent = '▲';
                }
                void this.plugin.saveData(this.plugin.settings);
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
                secondaryPanel.classList.remove('is-collapsed');
                if (this.currentSplitter) {
                    this.currentSplitter.classList.remove('is-hidden');
                }
                const collapseIcon = secondaryPanel.querySelector('.portals-collapse-icon');
                if (collapseIcon) collapseIcon.textContent = '▼';
            }
            void this.plugin.saveData(this.plugin.settings);
        }
    }

    //-- FolderNote
    private isFolderNote(file: TFile, folder: TFolder): boolean {
        if (folder.path === '/') {
            return file.extension === 'md' && file.name.toLowerCase() === (this.app.vault.getName() + '.md').toLowerCase() && file.parent?.path === '/';
        } else {
        return file.extension === 'md' && file.name.toLowerCase() === (folder.name + '.md').toLowerCase() && file.parent?.path === folder.path;
        }
    }

    //-- FolderNote Dot
    private hasFolderNote(folder: TFolder): boolean {
        return folder.children.some(child => 
            child instanceof TFile && this.isFolderNote(child, folder)
        );
    }

    //--getFolderNote
    private getFolderNote(folder: TFolder): TFile | undefined {
        return folder.children.find((child): child is TFile => 
            child instanceof TFile && this.isFolderNote(child, folder)
        );
    }

    //-- Settings Hash
    private getSettingsHash(): string {
        const s = this.plugin.settings;
        return JSON.stringify({
            spaces: s.spaces.map(sp => `${sp.type}:${sp.path}|${sp.icon}|${sp.color}|${sp.groupTags?.join(',') || ''}`).join(','),
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
            showFolderNotesInTree: s.showFolderNotesInTree,
            enableFolderNotes: s.enableFolderNotes,
            floatingButtonsCollapsed: s.floatingButtonsCollapsed,
        });
    }

    render() {
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
                        tab.style.setProperty('--tab-pinned-color', space.color);
                    } else {
                        tab.style.removeProperty('--tab-pinned-color');
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
                    if (!Platform.isMobile && !this.plugin.settings.showInactiveTabNames) {
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
                        tab.style.setProperty('--tab-active-color', space.color);
                    } else {
                        tab.style.removeProperty('--tab-active-color');
                    }
                } else {
                    tab.style.removeProperty('--tab-active-color');
                }
                
                tab.dataset.path = space.path;
                tab.dataset.type = space.type;

                if (space.icon) {
                    const iconSpan = tab.createSpan({ cls: 'portals-tab-icon' });
                    iconSpan.createEl('i', { cls: `ph ph-${space.icon}` });
                }

                tab.addEventListener('click', () => {
                    this.hideTooltip(0);
                    this.plugin.settings.selectedSpace = {
                        path: space.path,
                        type: space.type
                    };

                    if (space.type === 'folder' && !this.plugin.settings.openFolders.includes(space.path)) {
                        this.plugin.settings.openFolders.push(space.path);
                    }

                    void this.plugin.saveSettings()
                        .then(() => this.render())
                        .then(() => {
                            const newActiveTab = container.querySelector('.portals-tab.is-active');
                            if (newActiveTab) {
                                setTimeout(() => {
                                    newActiveTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                                }, 0);
                            }
                        });
                });
            }

           this.sortableInstance = new Sortable(tabBar, {
            animation: 150,
            delay: 400,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            scrollSensitivity: 30,
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Sortable expects void, but we use async for await
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

                // Add icon
                tabBtn.createEl('i', { cls: `ph ph-${icons[tabId] || 'file'}` });

                // Always create the span with class 'tab-label'
                const span = tabBtn.createEl('span', { cls: 'tab-label' });
                span.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1).replace('-', ' ');

                // Add tab inactice & setting off, hide label
                if (tabId !== activeTab && !this.plugin.settings.showInactiveTabNames) {
                    span.addClass('hide');
                }

                // Set initial active state
                if (tabId === activeTab) {
                    tabBtn.addClass('is-active');
                    if (rootColor) {
                        tabBtn.style.setProperty('--split-tab-active-color', rootColor);
                    }
                    span.removeClass('hide');
                } else {
                    // Hover tool tips for inactive (non-mobile)
                    if (!Platform.isMobile && tabId !== activeTab && !this.plugin.settings.showInactiveTabNames) {
                        const displayName = tabId.charAt(0).toUpperCase() + tabId.slice(1).replace('-',' ');
                        tabBtn.addEventListener('mouseenter', () => {
                            this.showTooltip(displayName, tabBtn);
                        });
                        tabBtn.addEventListener('mouseleave', () => {
                            this.hideTooltip(100);
                        });
                    }
                }
                // Click handler
                tabBtn.addEventListener('click', () => {
                    this.expandPanel();
                    this.plugin.settings.activeSplitTab = tabId;
                    void this.plugin.saveData(this.plugin.settings);

                    // Update all split tabs
                    tabContainer.querySelectorAll('.portals-split-tab').forEach(t => {
                        const currentTab = t as HTMLElement;
                        const currentId = currentTab.dataset.tabId;
                        if (!currentId) return;
                        
                        // Remove active class from all tabs
                        currentTab.removeClass('is-active');
                        currentTab.style.removeProperty('--split-tab-active-color');

                        // get span label
                        const labelSpan = currentTab.querySelector('span.tab-label');
                        if (labelSpan) {
                            if (!this.plugin.settings.showInactiveTabNames) {
                                labelSpan.addClass('hide');
                            } else {
                                labelSpan.removeClass('hide');
                            }
                        }
                    });
                    // Add active class to clicked tab
                    tabBtn.addClass('is-active');
                    if (rootColor) {
                        tabBtn.style.setProperty('--split-tab-active-color', rootColor);
                    }

                    // Ensure active tab has a label (if missing)
                    const activeLabel = tabBtn.querySelector('span.tab-label');
                    if (activeLabel) {
                        activeLabel.removeClass('hide');
                    }
                    // Render new content
                    this.renderSplitTabContent(secondaryPanel, tabId);
                });
            });

            // Collapse icon
            const collapseIcon = secondaryHeader.createSpan({ cls: 'portals-collapse-icon' });
            collapseIcon.textContent = this.plugin.settings.secondaryPanelCollapsed ? '▲' : '▼';  

            // Content area (collapsible)
            secondaryPanel.createDiv({ cls: 'portals-split-content' });

            // Set initial state
            const isCollapsed = this.plugin.settings.secondaryPanelCollapsed;
            if (!this.plugin.settings.sidePanelEnabled) {
                secondaryPanel.classList.add('is-disabled');
                splitter.classList.add('is-hidden');
            } else if (isCollapsed) {
                secondaryPanel.style.height = '42px';
                secondaryPanel.classList.add('is-collapsed');
                splitter.classList.add('is-hidden');
            } else {
                secondaryPanel.style.height = Math.max(this.plugin.settings.lastExpandedHeight, MIN_EXPANDED_HEIGHT) + 'px';
                secondaryPanel.classList.remove('is-collapsed');
                splitter.classList.remove('is-hidden');
            }

            // Toggle collapse on icon click
            collapseIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.plugin.settings.sidePanelEnabled) return;

                const newCollapsed = !this.plugin.settings.secondaryPanelCollapsed;
                this.plugin.settings.secondaryPanelCollapsed = newCollapsed;
                if (newCollapsed) {
                    secondaryPanel.style.height = '42px';
                    secondaryPanel.classList.add('is-collapsed');
                    splitter.classList.add('is-hidden');
                    collapseIcon.textContent = '▲';
                } else {
                    secondaryPanel.style.height = Math.max(this.plugin.settings.lastExpandedHeight, MIN_EXPANDED_HEIGHT) + 'px';
                    secondaryPanel.classList.remove('is-collapsed');
                    splitter.classList.remove('is-hidden');   
                    collapseIcon.textContent = '▼';   
                }
                void this.plugin.saveData(this.plugin.settings);
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
                    this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon, selectedSpace.groupTags);
                }
            }

            // Floating buttons (attached to mainPanel)
            const createFloatingButton = (
                icon: string,
                tooltip: string,
                bottom: number,
                onClick: (e: MouseEvent) => void,
                onContextMenu?: (e: MouseEvent) => void
            ) => {
                const btn = mainPanel.createEl('button', { cls: 'portals-floating-btn' });
                btn.style.bottom = bottom + 'px';
                btn.empty();
                btn.createEl('i', { cls: `ph ph-${icon}` });
                if (!Platform.isMobile) {
                    btn.addEventListener('mouseenter', () => this.showTooltip(tooltip, btn));
                    btn.addEventListener('mouseleave', () => this.hideTooltip(100));
                }
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const el = e.currentTarget as HTMLElement;
                    el.blur();
                    el.style.display = 'none';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            el.style.display = '';
                        });
                    });
                    onClick(e);
                });

                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const el = e.currentTarget as HTMLElement;
                    el.blur();
                    if ((el as any).__contextmenuFired) return;
                    (el as any).__contextmenuFired = true;
                    setTimeout(() => delete (el as any).__contextmenuFired, 300);
                    if (onContextMenu) {
                        onContextMenu(e);
                    }
                });
                return btn;
            };

            if (this.plugin.settings.floatingButtonsCollapsed) {
                createFloatingButton('stack-simple', 'Collapse/ Unfold', 10,
                    () => this.collapseAllFolders(),
                    (e: MouseEvent) => this.toggleFloatingButtonsCollapse(e)
                );
            } else {
                // Expanded mode: all four buttons
                createFloatingButton('file-plus', 'New note', 136, () => {
                    (async () => {
                        const currentSpace = this.plugin.settings.spaces.find(s => 
                            s.path === this.plugin.settings.selectedSpace?.path && 
                            s.type === this.plugin.settings.selectedSpace?.type
                        );

                        if (!currentSpace) {
                            new Notice('Please select a folder space first.');
                            return;
                        }

                        if (currentSpace.type === 'folder') {
                            const folder = this.app.vault.getAbstractFileByPath(currentSpace.path);
                            if (!(folder instanceof TFolder)) {
                                new Notice('Selected space is not a valid folder.');
                            return;
                            }
                            await this.newNoteInFolder(folder);
                        } else if (currentSpace.type === 'tag') {
                            await this.newNoteInTagSpace(currentSpace.path);
                        }

                    })().catch(err => console.error('Error creating note:', err));
                });

                // second button: folder or filter
                const currentSpace = this.plugin.settings.spaces.find(s =>
                    s.path === this.plugin.settings.selectedSpace?.path &&
                    s.type === this.plugin.settings.selectedSpace?.type
                );

                if (currentSpace && currentSpace.type === 'folder') {
                    createFloatingButton('folder-simple-plus', 'New folder', 94, () => {
                        (async () => {
                            const folder = this.app.vault.getAbstractFileByPath(currentSpace.path);
                            if (!(folder instanceof TFolder)) {
                                new Notice('Selected space is not a valid folder.');
                                return;
                            }
                            await this.newFolderInFolder(folder);
                        })().catch(err => console.error('Error creating folder:', err));
                    });
                } else if (currentSpace && currentSpace.type === 'tag') {
                    // compute tags that co-occuer with main tag
                    const mainTag = currentSpace.path;
                    const allFiles = this.app.vault.getMarkdownFiles();
                    const filesWithMainTag = allFiles.filter(file => {
                        const cache = this.app.metadataCache.getFileCache(file);

                        return cache?.tags?.some(t => t.tag === '#' + mainTag) || cache?.frontmatter?.tags?.includes(mainTag);
                    });
                    const tagSet = new Set<string>();
                    filesWithMainTag.forEach(file => {
                        const cache = this.app.metadataCache.getFileCache(file);
                        const fileTags = [
                            ...(cache?.tags?.map(t => t.tag.slice(1)) || []),
                            ...(cache?.frontmatter?.tags || [])
                        ];
                        fileTags.forEach(t => tagSet.add(t));
                    });
                    tagSet.delete(mainTag)
                    const relevantTags = Array.from(tagSet).sort();

                    createFloatingButton('funnel-simple', 'Tag groups', 94, (e) => {
                        new GroupTagsModal(this.app, this.plugin, currentSpace, (tags) => {
                            currentSpace.groupTags = tags;

                            // cleanup expandedGroups for this space
                            const expanded = this.plugin.settings.expandedGroups[currentSpace.path];
                            if (expanded) {
                                const validExpanded = expanded.filter(t => currentSpace.groupTags?.includes(t));
                                if (validExpanded.length !== expanded.length) {
                                    this.plugin.settings.expandedGroups[currentSpace.path] = validExpanded;
                                }
                            }
                            this.plugin.saveSettings().then(() => this.render());
                        }, relevantTags).open();
                    });
                }

                createFloatingButton('caret-circle-up-down', 'Sort', 52, (e: MouseEvent) => {
                    const menu = new Menu();
                    const setSort = (by: 'name' | 'created' | 'modified', order: 'asc' | 'desc') => {
                        this.plugin.settings.sortBy = by;
                        this.plugin.settings.sortOrder = order;
                        void this.plugin.saveData(this.plugin.settings);
                        this.renderContent();
                    };
                    menu.addItem(item => item
                        .setTitle('Name ascending')
                        .setChecked(this.plugin.settings.sortBy === 'name' && this.plugin.settings.sortOrder === 'asc')
                        .onClick(() => setSort('name', 'asc')));
                    menu.addItem(item => item
                        .setTitle('Name descending')
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

                // Collapse button with contextmenu toggling
                createFloatingButton('stack', 'Collapse/ Fold', 10,
                    () => this.collapseAllFolders(),
                    (e: MouseEvent) => this.toggleFloatingButtonsCollapse(e)
                );
            }
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

                if (this.isFileOpen(file)) {
                    fileEl.createSpan({ cls: 'open-dot' });
                }

                fileEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void this.app.workspace.getLeaf().openFile(file);
                });

                fileEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showFileContextMenu(e, file, fileEl);
                });
            }

        } else if (tabId === 'folder-notes') {
            if (!this.plugin.settings.enableFolderNotes) {
                contentEl.createEl('p', {
                    text: 'Folder notes are disabled. Enable them in settings.',
                    cls: 'portals-folder-note-message'
                });
                return;
            }
            this.renderFolderNotesTab(contentEl);
        } else if (tabId === 'bookmarks') {
            this.renderBookmarksTab(contentEl);
        }
    }

    // Bookmarks

    private renderBookmarksTab(contentEl: HTMLElement) {
    // Try public API first (future-proofing)
    // @ts-expect-error - accessing public bookmarks API
    const publicBookmarks = this.app.bookmarks;
    let items: BookmarkItem[] = [];
    let usePublic = false;

    if (publicBookmarks) {
        // Public API might have getBookmarks() or .items
        if (typeof publicBookmarks.getBookmarks === 'function') {
            items = publicBookmarks.getBookmarks() as BookmarkItem[];
            usePublic = true;
        } else if (Array.isArray(publicBookmarks.items)) {
            items = publicBookmarks.items;
            usePublic = true;
        }
    }

    // Fallback to internal plugin if public API not available or returned nothing
    if (!usePublic || items.length === 0) {
        // @ts-expect-error -- accessing internal plugin API
        const bookmarksPlugin = this.app.internalPlugins?.getPluginById('bookmarks');
        if (!bookmarksPlugin?.enabled || !bookmarksPlugin.instance) {
            contentEl.createEl('p', { text: 'The bookmarks core plugin is not enabled. Settings → core plugins.' });
            return;
        }
        items = bookmarksPlugin.instance.items as BookmarkItem[];
        if (!items || !Array.isArray(items)) {
            contentEl.createEl('p', { text: 'No bookmarks found.' });
            return;
        }
    }

    if (items.length === 0) {
        contentEl.createEl('p', { text: 'No bookmarks found.' });
        return;
    }

    // Helper to refresh the tab after deletion
    const refresh = () => {
        const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
        if (secondaryPanel) {
            this.renderSplitTabContent(secondaryPanel as HTMLElement, 'bookmarks');
        }
    };

    // Recursive render function
    const renderItem = (item: BookmarkItem, container: HTMLElement) => {
        // Check if this is a folder/group
        const isFolder = item.children && Array.isArray(item.children) && item.children.length > 0 ||
                        item.type === 'group' || item.type === 'folder';

        if (isFolder) {
            // Folder/group
            const details = container.createEl('details', { cls: 'folder-details' });
            details.setAttr('open', 'true');
            const summary = details.createEl('summary', { cls: 'folder-summary' });
            const iconSpan = summary.createSpan({ cls: 'folder-icon' });
            iconSpan.createEl('i', { cls: 'ph ph-folder' });
            const nameSpan = summary.createSpan({ text: item.title || 'Group' });
            nameSpan.addClass('portals-item-name');

            summary.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = new Menu();
                menu.addItem(menuItem => menuItem
                    .setTitle('Delete group')
                    .setIcon('trash')
                    .onClick(() => {
                        this.deleteBookmarkItem(item, usePublic, refresh);
                    })
                );
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });

            const childrenContainer = details.createDiv({ cls: 'folder-children' });
            // Use the correct property for children – some APIs use 'items' instead of 'children'
            const children = item.children || (item as any).items || [];
            children.forEach((child: BookmarkItem) => renderItem(child, childrenContainer));
        } else {
            // Leaf item (file, note, url)
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
            fileEl.dataset.path = item.path || item.url || '';

            // Left‑click to open
            fileEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.type === 'url' || item.url) {
                    const url = item.url || item.path;
                    if (url) window.open(url, '_blank');
                } else if (item.type === 'file' || item.path) {
                    if (item.path) {
                        const file = this.app.vault.getAbstractFileByPath(item.path);
                        if (file instanceof TFile) {
                            void this.app.workspace.getLeaf().openFile(file);
                        } else if (file instanceof TFolder) {
                            void this.app.workspace.openLinkText(item.path, '/', false);
                        }
                    }
                } else if (item.type === 'folder') {
                    if (item.path) {
                        void this.app.workspace.openLinkText(item.path, '/', false);
                    }
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
                        this.deleteBookmarkItem(item, usePublic, refresh);
                    })
                );
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            });
        }
    };
    items.forEach(item => renderItem(item, contentEl));
}

// Helper method to delete a bookmark item (add this to your class)
private deleteBookmarkItem(item: BookmarkItem, usePublic: boolean, refresh: () => void) {
    if (usePublic) {
        // @ts-ignore-- accessing public bookmarks API
        const publicBookmarks = this.app.bookmarks;
        if (publicBookmarks?.remove && item.id) {
            publicBookmarks.remove(item.id);
        }
    } else {
        // @ts-expect-error - accessing internal plugin API
        const bookmarksPlugin = this.app.internalPlugins?.getPluginById('bookmarks');
        if (!bookmarksPlugin?.instance) return;
        // Try different deletion methods
        if (typeof bookmarksPlugin.instance.removeItem === 'function') {
            bookmarksPlugin.instance.removeItem(item);
        } else if (typeof bookmarksPlugin.instance.delete === 'function') {
            bookmarksPlugin.instance.delete(item);
        } else if (item.id && typeof bookmarksPlugin.instance.deleteItem === 'function') {
            bookmarksPlugin.instance.deleteItem(item.id);
        }
    }
    refresh();
}
    // End of bookmark

    // Folder note

    private async createFolderNote(folder: TFolder) {
    const noteName = folder.name + '.md';
    const notePath = folder.path === '/' ? noteName : `${folder.path}/${noteName}`;

    try {
        const file = await this.app.vault.create(notePath, `# ${folder.name}\n\n`);
        await this.app.workspace.getLeaf().openFile(file);
        new Notice('Folder note created.');
    } catch (err) {
        // If creation fails because file already exists, try to open it
        const existing = this.app.vault.getAbstractFileByPath(notePath);
        if (existing instanceof TFile) {
            new Notice('Folder note already exists. Opening it.');
            await this.app.workspace.getLeaf().openFile(existing);
        } else {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create folder note: ${message}`);
        }
    }

    // Refresh side portal if active
    if (this.plugin.settings.activeSplitTab === 'folder-notes') {
        const secondaryPanel = this.containerEl.querySelector('.portals-secondary-panel');
        if (secondaryPanel) {
            const contentEl = secondaryPanel.querySelector('.portals-split-content') as HTMLElement;
            if (contentEl) {
                contentEl.empty();
                this.renderFolderNotesTab(contentEl);
            }
        }
    }
}

    //--RenderFolderNotesTab
    
    private renderFolderNotesTab(contentEl: HTMLElement) {
        const selectedSpace = this.plugin.settings.selectedSpace;
        if (!selectedSpace || selectedSpace.type !== 'folder') {
            contentEl.createEl('p', { 
                text: 'Select a folder portal tab to view its folder note.',
                cls: 'portals-folder-note-message'
             });
            return;
        }

        let targetFile: TFile | null = null;

        if (selectedSpace.path === '/') {
            // Root folder: look for a file named after the vault
            const vaultName = this.app.vault.getName();
            const rootNotePath = vaultName + '.md';
            const file = this.app.vault.getAbstractFileByPath(rootNotePath);
            targetFile = file instanceof TFile ? file : null;

            if (!targetFile) {
                contentEl.createEl('p', {
                    text: 'No folder note found for the vault root. Create a file named exactly like your vault at the root to use as folder note.',
                    cls: 'portals-folder-note-message'
                });
                return;
            }
        } else {
            // Non‑root folder: get the folder and find its note
            const folder = this.app.vault.getAbstractFileByPath(selectedSpace.path);
            if (!(folder instanceof TFolder)) {
                contentEl.createEl('p', { 
                    text: 'Folder not found.',
                    cls: 'portals-folder-note-message'
                 });
                return;
            }

            const folderNote = folder.children.find((child): child is TFile => 
                child instanceof TFile && this.isFolderNote(child, folder)
            );

            if (!folderNote) {
                contentEl.createEl('p', { 
                    text: 'No folder note found for this folder. Create one using the folder context menu or start a file with same name as the portal space folder.',
                    cls: 'portals-folder-note-message'    
                });
                return;
            }

            targetFile = folderNote;
        }

        // Render the note content
        this.renderFolderNoteContent(targetFile, contentEl);
    }

    //---RenderFoldernote Helper

    private renderFolderNoteContent(file: TFile, container: HTMLElement) {
        const noteContainer = container.createDiv({ cls: 'markdown-preview-view' });

        this.app.vault.read(file).then(async (content) => {
            try {
                const component = new Component();
                this.addChild(component);
                await MarkdownRenderer.render(this.app, content, noteContainer, file.path, component);
                await this.processEmbeds(noteContainer, component, file.path);
            } catch (e) {
                console.error('Error rendering folder note:', e);
                noteContainer.setText('Error rendering note.');
            }
        }).catch(e => {
            console.error('Error reading folder note:', e);
            noteContainer.setText('Error reading note.');
        });

        noteContainer.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('a')) return;
            void this.app.workspace.getLeaf().openFile(file);
        });
    }

    //--Embed Method
    private async processEmbeds(container: HTMLElement, component: Component, sourcePath: string, depth = 0): Promise<void> {
        if (depth > 5) return;
        const embeds = container.querySelectorAll('.internal-embed:not(.processed)');
        for (const embed of Array.from(embeds)) {
            embed.classList.add('processed');
            const src = embed.getAttribute('src') || embed.getAttribute('data-src');
            if (!src) continue;

            const parts = src.split('#');
            const cleanSrc = parts[0];
            if (!cleanSrc) continue;
            const anchor = parts.length > 1 ? parts[1] : null;

            const targetFile = this.app.metadataCache.getFirstLinkpathDest(cleanSrc, sourcePath);
            if (!(targetFile instanceof TFile)) continue;

            // Recursively render Markdown files
            if (targetFile.extension === 'md') {
                const targetContainer = container.createDiv({ cls: 'markdown-preview-view' });
                targetContainer.setAttr('data-source-path', targetFile.path);
                const content = await this.app.vault.read(targetFile);
                const childComponent = new Component();
                component.addChild(childComponent);
                await MarkdownRenderer.render(this.app, content, targetContainer, targetFile.path, childComponent);
                await this.processEmbeds(targetContainer, childComponent, targetFile.path, depth + 1);
                embed.replaceWith(targetContainer);
                continue;
            }

            // For all other file types (including .base), create a styled link
            const linkContainer = container.createDiv({ cls: 'portals-embed-link' });
            const link = linkContainer.createEl('a', { href: '#' });
            link.setText(targetFile.name + (anchor ? ` → ${anchor}` : ''));
            link.addEventListener('click', (e) => {
                e.preventDefault();
                void this.app.workspace.getLeaf().openFile(targetFile);
            });
            embed.replaceWith(linkContainer);
        }
    }
    
    //--End of process embed, start of renderContent


    renderContent() {
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
            this.buildTagSpace(selectedSpace.path, spaceContent, selectedSpace.icon, selectedSpace.groupTags);
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

        // Remove any previous background classes
        el.removeClass('solid-bg', 'gradient-bg');

        if (style === 'none' || bgColor === 'transparent') {
            el.style.removeProperty('--space-bg-color');
            return;
        }

        el.style.setProperty('--space-bg-color', bgColor);
        if (style === 'solid') {
            el.addClass('solid-bg');
        } else if (style === 'gradient') {
            el.addClass('gradient-bg');
        }
    }

    private getDisplayName(file: TFile): string {
        if (file.extension === 'md') {
            return file.basename;
        }
        return file.name;
    }

    private buildTagSpace(tagName: string, container: HTMLElement, iconName: string, groupTags?: string[]) {
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

        // Sort helper (already in your method)
        const sortFiles = (files: TFile[]) => files.sort((a, b) => {
            const sortBy = this.plugin.settings.sortBy;
            const sortOrder = this.plugin.settings.sortOrder;
            let aVal: string | number, bVal: string | number;
            switch (sortBy) {
                case 'name': aVal = a.name; bVal = b.name; break;
                case 'created': aVal = a.stat.ctime; bVal = b.stat.ctime; break;
                case 'modified': aVal = a.stat.mtime; bVal = b.stat.mtime; break;
                default: aVal = a.name; bVal = b.name;
            }
            if (sortOrder === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            else return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        });

        // Create main details element for the tag
        const mainDetails = container.createEl('details', { cls: 'folder-details' });
        mainDetails.setAttr('open', 'true');
        const mainSummary = mainDetails.createEl('summary', { cls: 'folder-summary' });
        const mainIconSpan = mainSummary.createSpan({ cls: 'folder-icon' });
        mainIconSpan.createEl('i', { cls: `ph ph-${iconName || 'tag'}` });
        mainSummary.createSpan({ text: '#' + tagName }).addClass('portals-item-name');
        const childrenContainer = mainDetails.createDiv({ cls: 'folder-children' });

        // Local function to create a file item (copied from your existing loop)
        const createFileItem = (file: TFile, parent: HTMLElement) => {
            const fileEl = parent.createDiv({ cls: 'file-item' });
            const iconSpan = fileEl.createSpan({ cls: 'file-icon' });
            iconSpan.createEl('i', { cls: 'ph ph-file' });
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
                    void this.app.workspace.getLeaf().openFile(file);
                }
            });

            fileEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showFileContextMenu(e, file, fileEl);
            });
        };

        // If no groups, just list all files under the main tag
        if (!groupTags || groupTags.length === 0) {
            for (const file of sortFiles(taggedFiles)) {
                createFileItem(file, childrenContainer);
            }
            return;
        }

        // Build groups map
        const groups = new Map<string, TFile[]>();
        groupTags.forEach(t => groups.set(t, []));
        const ungrouped: TFile[] = [];

        for (const file of taggedFiles) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fileTags = new Set([
                ...(cache?.tags?.map(t => t.tag.slice(1)) || []),
                ...(cache?.frontmatter?.tags || [])
            ]);

            let hasGroup = false;
            for (const gTag of groupTags) {
                if (fileTags.has(gTag)) {
                    groups.get(gTag)!.push(file);
                    hasGroup = true;
                }
            }
            if (!hasGroup) ungrouped.push(file);
        }

        // Render each group as a nested details element (always open)
        for (const [gTag, files] of groups.entries()) {
            if (files.length === 0) continue;
            const groupDetails = childrenContainer.createEl('details', { cls: 'folder-details' });
            const saveExpanded = this.plugin.settings.expandedGroups[tagName] || [];
            if (saveExpanded.includes(gTag)) {
                groupDetails.open = true;
            } else {
                groupDetails.open = false; // default closed
            }
            const summary = groupDetails.createEl('summary', { cls: 'folder-summary' });
            const iconSpan = summary.createSpan({ cls: 'folder-icon' });
            iconSpan.createEl('i', { cls: 'ph ph-tag-simple' });
            summary.createSpan({ text: '#' + gTag }).addClass('portals-item-name');
            const groupChildren = groupDetails.createDiv({ cls: 'folder-children' });
            for (const file of sortFiles(files)) {
                createFileItem(file, groupChildren);
            }

            groupDetails.addEventListener('toggle', () => {
                const isOpen = groupDetails.open;
                let expanded = this.plugin.settings.expandedGroups[tagName] || [];
                if (isOpen) {
                    if (!expanded.includes(gTag)) {
                        expanded = [...expanded, gTag];
                    }
                } else {
                    expanded = expanded.filter(t => t !== gTag);
                }
                this.plugin.settings.expandedGroups[tagName] = expanded;
                void this.plugin.saveSettings(); // no re‑render because hash unchanged
            });
        }

        // Render ungrouped files directly under main tag
        for (const file of sortFiles(ungrouped)) {
            createFileItem(file, childrenContainer);
        }
    }

    private showFileContextMenu(event: MouseEvent, file: TFile, fileEl: HTMLElement) {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle('Open in new tab')
            .setIcon('document')
            .onClick(() => void this.app.workspace.getLeaf('tab').openFile(file)));

        menu.addItem(item => item
            .setTitle('Open to the right')
            .setIcon('file-symlink')
            .onClick(() => void this.app.workspace.getLeaf('split', 'vertical').openFile(file)));

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle('Delete')
            .setIcon('trash')
            .onClick(() => void this.deleteFile(file)));

        menu.addItem(item => item
            .setTitle('Duplicate')
            .setIcon('copy')
            .onClick(() => void this.duplicateFile(file)));

        menu.addItem(item => item
            .setTitle('Rename')
            .setIcon('pencil')
            .onClick(() => this.startRenameFile(file, fileEl)));

        menu.addSeparator();

        this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private showFolderContextMenu(event: MouseEvent, folder: TFolder, summaryEl: HTMLElement) {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle('New note')
            .setIcon('document')
            .onClick(() => void this.newNoteInFolder(folder)));

        menu.addItem(item => item
            .setTitle('New folder')
            .setIcon('folder')
            .onClick(() => void this.newFolderInFolder(folder)));

        menu.addItem(item => item
            .setTitle('New canvas')
            .setIcon('layout-dashboard')
            .onClick(() => void this.newCanvasInFolder(folder)));

        if (this.plugin.settings.enableFolderNotes && folder.path !== '/') {
            const folderNote = folder.children.find((child): child is TFile =>
                child instanceof TFile && this.isFolderNote(child, folder));
            if (folderNote) {
                menu.addItem(item => item
                    .setTitle('Open folder note')
                    .setIcon('note')
                    .onClick(() => void this.app.workspace.getLeaf().openFile(folderNote)));
            } else {
                menu.addItem(item => item
                    .setTitle('Create folder note')
                    .setIcon('plus')
                    .onClick(() => void this.createFolderNote(folder)));
            }
        }

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle('Delete')
            .setIcon('trash')
            .onClick(() => void this.deleteFolder(folder)));

        menu.addItem(item => item
            .setTitle('Duplicate')
            .setIcon('copy')
            .onClick(() => this.executeCommand('file-explorer:copy-folder')));

        menu.addItem(item => item
            .setTitle('Rename')
            .setIcon('pencil')
            .onClick(() => this.startRenameFolder(folder, summaryEl)));

        menu.addSeparator();

        this.app.workspace.trigger('file-menu', menu, folder, 'file-explorer');

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private executeCommand(commandId: string) {
        try {
            // @ts-expect-error - accessing commands API which is not typed
            this.app.commands.executeCommandById(commandId);
        } catch (err) {
            const message = err instanceof Error ? err.message: String(err);
            console.error(`Command failed: ${commandId}`, err);
            new Notice(`Command failed: ${message}`);
        }
    }

    private createRenameInput(initialValue: string, onSave: (val: string) => void, onCancel: () => void): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initialValue;
        input.addClass('portals-rename-input');

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

        const input = this.createRenameInput(base, (newBase) => {
            (async () => {
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
            })().catch(err => console.error('Rename error:', err));
        }, () => {
            this.renaming = false;
            document.removeEventListener('mousedown', outsideClickListener);
            this.renderContent();
        });

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

        const input = this.createRenameInput(folder.name, (newName) => {
            (async () => {
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
            })().catch(err => console.error('Rename error:', err));
        }, () => {
            this.renaming = false;
            document.removeEventListener('mousedown', outsideClickListener);
            this.renderContent();
        });

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

    private triggerRenameOnPath(path: string) {
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
                // @ts-expect-error - accessing view.file which is not typed
                return view && view.file && view.file.path === file.path;
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
        try {
            await this.app.fileManager.trashFile(file);
            new Notice(`File "${file.name}" moved to trash`, 2000); // auto-hide after 2s
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Delete failed: ${message}`, 3000);
        }
    }

    private async deleteFolder(folder: TFolder) {
        try {
            await this.app.fileManager.trashFile(folder);
            new Notice(`Folder "${folder.name}" moved to trash`, 2000);
            this.renderContent();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Delete failed: ${message}`, 3000);
        }
    }


    // New Note creation in Folder space
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

            this.renderContent();
            this.triggerRenameOnPath(newFile.path);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create note: ${message}`);
        }
    }

    // New Folder Creation in Folder space
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

            this.renderContent();
            this.triggerRenameOnPath(candidate);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create folder: ${message}`);
        }
    }

    // New Canvas creation in Folder Space
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

    // New Note Creation in Tag Space
    private async newNoteInTagSpace(tagName: string) {
        const defaultName = 'Untitled.md'
        let candidate = defaultName;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `Untitled ${counter}.md`;
            counter++;
        }
        try {
            const newFile = await this.app.vault.create(candidate, '');
            // add the tag to frontmatter
            await this.app.fileManager.processFrontMatter(newFile, (frontmatter) => {
                if (!frontmatter.tags) {
                    frontmatter.tags = [tagName];
                } else if (Array.isArray(frontmatter.tags)) {
                    if (!frontmatter.tags.includes(tagName)) {
                        frontmatter.tags.push(tagName);
                    }
                } else {
                    // if tags is a string, convert to array
                    const existing = frontmatter.tags
                    frontmatter.tags = [existing, tagName];
                }
            });
            await this.app.workspace.getLeaf().openFile(newFile);
            this.renderContent();
            this.triggerRenameOnPath(newFile.path);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice('Failed to create note: ${message}');
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
        el.addEventListener('drop', (e) => {
            (async () => {
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
            })().catch(err => console.error(err));
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
        if (this.plugin.settings.enableFolderNotes && this.hasFolderNote(folder)) {
            iconSpan.addClass('has-folder-note');
        }

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

        summary.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault()
                e.stopPropagation()

                const folderNote = this.getFolderNote(folder);
                if (folderNote) {
                    void this.app.workspace.getLeaf('tab').openFile(folderNote);
                }
            }
        });


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
                }   else if (child instanceof TFile) {
                    const isFolderNoteFile = this.isFolderNote(child, folder);
                    if (isFolderNoteFile && this.plugin.settings.enableFolderNotes) {
                        if (!this.plugin.settings.showFolderNotesInTree) continue;
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
                            void this.app.workspace.getLeaf().openFile(child);
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
            void this.plugin.saveData(this.plugin.settings);
        });
    }

    private sortFolderChildren(children: TAbstractFile[]): TAbstractFile[] {
        const folders = children.filter((c): c is TFolder => c instanceof TFolder);
        const files = children.filter((c): c is TFile => c instanceof TFile);

        folders.sort((a, b) => a.name.localeCompare(b.name));

        const fileSortFunc = (a: TFile, b: TFile) => {
            let aVal: string | number, bVal: string | number;
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