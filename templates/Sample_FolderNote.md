### Overview
Write your folder overview, add links to your important files. This is a starter note to get you started. It displayes unfinished tasks (checkboxes) form your folder. Replace your target folder name with `YourFolder` in the codes. For more, Items in the list, increase the `LIMIT` in code. This requires the [Dataview](https://obsidian.md/plugins?id=dataview) plugin from obsidian. 

### Tasks
```dataview
TASK
FROM "YourFolder"
WHERE !completed
LIMIT 5
```
--

## Recents 
```dataview
TABLE file.tags AS "Tags"
FROM "YourFolder"
SORT file.mtime DESC
LIMIT 5
```