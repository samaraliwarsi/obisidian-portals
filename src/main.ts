import { Plugin } from 'obsidian';
import { PortalsView, VIEW_TYPE_PORTALS } from './view';
import { SpacesSettings, DEFAULT_SETTINGS, SpacesSettingTab } from './settings';

export default class PortalsPlugin extends Plugin {
    settings: SpacesSettings;

    async onload() {
        await this.loadSettings();

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
}