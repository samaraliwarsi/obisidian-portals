# Migration Guide
## ⚠️ Important: Required for 1.1.1, if you are updating from any previous version (v1.1.0 or earlier)
The plugin ID has changed from `obsidian-portals` to `portals` to follow Obsidian's guidelines. Your settings won't be updated automatically for this round. If you are updating from an older version (1.1.0 or earlier), please follow these steps to keep your settings. There are two ways to do this, 
### Export/Import of json file
1. **Export** using the older version. Use the feature provided at the bottom of the settings page. Save the json file at a safe location.
2. **Unintall Portals**
3. **Reinstall** the latest version
3. **Import** using the newer version. Use the feature provided at the bottom of the settings page. Select the json file you saved earlier.

### Use Data File
1. **Close Obsidian** completely.
>2. **Navigate to your vault's `.obsidian/plugins/` folder**.
>3. You will see an old folder named `obsidian-portals`. Inside it, find the file `data.json` – this contains all your portal configurations.
>4. **Create a new folder** named `portals` in the same location (if it doesn't already exist).
>5. **Copy the `data.json` file** from the `obsidian-portals` folder into the new `portals` folder.
>6. (Optional) After confirming everything works, you may delete the old `obsidian-portals` folder.
>7. **Restart Obsidian** and enable the new plugin (`Portals`). Your settings should now be restored.
>8. If you prefer, you can start fresh – your old settings will not be used automatically.