import { Plugin, TFolder } from 'obsidian';
import { PortalsView, VIEW_TYPE_PORTALS } from './view';
import { SpacesSettings, DEFAULT_SETTINGS, SpacesSettingTab } from './settings';

export default class PortalsPlugin extends Plugin {
    settings: SpacesSettings;

    async onload() {
        await this.loadSettings();

        // Ensure the selected space (if it's a folder) is in openFolders
        const selectedSpace = this.settings.spaces.find(s => s.path === this.settings.selectedSpace);
        if (selectedSpace && selectedSpace.type === 'folder') {
            if (!this.settings.openFolders.includes(selectedSpace.path)) {
                this.settings.openFolders.push(selectedSpace.path);
                await this.saveSettings();
            }
        }

        this.registerView(
            VIEW_TYPE_PORTALS,
            (leaf) => new PortalsView(leaf, this)
        );

        this.addRibbonIcon('folder-tree', 'Open Portals', () => {
            this.activateView();
        });

        this.addSettingTab(new SpacesSettingTab(this.app, this));

        // If replaceFileExplorer is enabled, set up the left sidebar
        if (this.settings.replaceFileExplorer) {
            // Delay a bit to let Obsidian finish initial layout
            setTimeout(() => {
                this.setupLeftSidebar();
            }, 200);
        }
    }

    async onunload() { }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        // Migrate old spaces (pre-type) to have type 'folder'
        if (this.settings.spaces) {
            this.settings.spaces.forEach(space => {
                if (!space.type) {
                    space.type = 'folder';
                }
            });
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PORTALS).forEach(leaf => {
            if (leaf.view instanceof PortalsView) {
                leaf.view.render();
            }
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_PORTALS)[0];
        if (!leaf) {
            const newLeaf = workspace.getLeftLeaf(false);
            if (newLeaf) {
                leaf = newLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_PORTALS, active: true });
            } else {
                return;
            }
        }
        workspace.revealLeaf(leaf);
    }

    async setupLeftSidebar() {
        const { workspace } = this.app;
        // Check if our view is already in the left sidebar
        let portalsLeaf = workspace.getLeavesOfType(VIEW_TYPE_PORTALS)[0];
        if (!portalsLeaf) {
            // Create a new leaf in the left sidebar
            const newLeaf = workspace.getLeftLeaf(false);
            if (newLeaf) {
                await newLeaf.setViewState({ type: VIEW_TYPE_PORTALS, active: true });
                portalsLeaf = newLeaf;
            } else {
                return;
            }
        }
        // Make the Portals leaf active (brings it to front)
        workspace.revealLeaf(portalsLeaf);
    }

    // ========== MANUAL CLEANUP ==========
    async cleanupDeadSpaces(): Promise<number> {
        // Get all existing folder paths
        const allFiles = this.app.vault.getAllLoadedFiles();
        const existingFolders = allFiles.filter(f => f instanceof TFolder).map(f => f.path);

        // Get all existing tags (as strings with '#')
        const tags = Object.keys((this.app.metadataCache as any).getTags()); // e.g. ['#tag1', '#tag2']

        // Filter spaces
        const beforeCount = this.settings.spaces.length;
        this.settings.spaces = this.settings.spaces.filter(space => {
            if (space.type === 'folder') {
                return existingFolders.includes(space.path);
            } else if (space.type === 'tag') {
                return tags.includes('#' + space.path);
            }
            return false;
        });

        // Clean up openFolders
        this.settings.openFolders = this.settings.openFolders.filter(path => existingFolders.includes(path));

        // Adjust selected space if it's gone
        if (this.settings.selectedSpace) {
            const stillExists = this.settings.spaces.some(s => s.path === this.settings.selectedSpace);
            if (!stillExists) {
                this.settings.selectedSpace = this.settings.spaces[0]?.path || null;
            }
        }

        // Save if anything changed
        if (beforeCount !== this.settings.spaces.length) {
            await this.saveSettings();
        }
        return beforeCount - this.settings.spaces.length; // number removed
    }
}