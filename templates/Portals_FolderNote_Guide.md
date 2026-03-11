## Folder Notes Views Guide

Seasoned **Dataview** user? Skip this guide and fly!

Here are a few **DataView query ideas**, ranging from simple lists to semi-advanced summaries, that can help you visualise and access data in your from the folder notes, directly from the side portal. Install [Dataview](https://obsidian.md/plugins?id=dataview), enable the plugin and turn on inline Javascript queries (for advanced views). Copy the styles you like and paste it into your folder notes, make sure to switch the path inside the query. For a root folder, you can directly write the name of the folder. If it's further inside the tree, make sure to get the path right (eg. `folder/folder`) 

---
## Views
### 1. Basic File List
Shows all notes in the folder as a clickable list. You can change the `LIMIT` to display more files. 
```dataview
LIST
FROM "Corner"
SORT file.name ASC
LIMIT 5
```

**Edit options:**  
- Replace `"Corner"` with your actual folder path.  
- Change `LIMIT 10` to any number to show more/fewer files.  
- Modify `SORT file.name ASC` to sort by other fields (e.g., `file.ctime DESC`). 

---
### 2. Basic Table with Metadata
Displays file name, creation date, last modified, and any tags.  
```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified", file.tags AS "Tags"
FROM "Corner"
SORT file.mtime DESC
LIMIT 5
```

**Edit options:**  
- Replace `"Corner"` with your folder path.  
- Adjust `LIMIT 5` to show more rows.  
- Change the displayed columns by adding/removing fields (e.g., add `file.size`).  
- Modify `SORT file.mtime DESC` to sort by a different property.

---
### 3. Task List from All Notes
Collects every incomplete task from notes in the folder.  

```dataview
TASK
FROM "Corner"
WHERE !completed
LIMIT 5
```

**Edit options:**  
- Replace `"Corner"` with your folder path.  
- Change `LIMIT 10` as needed.  
- To show all tasks (including completed), remove `WHERE !completed`.  
- Add additional filters like `WHERE text.includes("urgent")`.

---
### 4. Missing Metadata Check
Finds notes that are missing a specific front matter field (e.g., `tags`). Great for maintaining consistency.  You can check for properties as well. 
```dataview
LIST file.link
FROM "/"
WHERE !file.tags 
LIMIT 5
```

**Edit options:**  
- Replace `"/"` with a specific folder path to limit the search.  
- Change `file.tags` to any other frontmatter field (e.g., `status`, `author`).  
- Use `!field` to find notes where that field is missing or empty.

---
### 5. Recently Modified
Shows the 10 most recently updated files.  

```dataview
TABLE file.mtime AS "Last Modified", file.tags AS "Tags"
FROM "Corner"
SORT file.mtime DESC
LIMIT 10
```

**Edit options:**  
- Replace `"Corner"` with your folder.  
- Adjust `LIMIT 10` to show more or fewer results.  
- Add more columns (e.g., `file.ctime`).  
- Change sorting to `file.ctime DESC` for recently created.

---
### 6. Orphan Notes (No Backlinks)
Lists files that are not linked from any other note in the vault (or within the folder).  

```dataview
LIST
FROM "Corner"
WHERE length(file.inlinks) = 0
LIMIT 5
```

**Edit options:**  
- Replace `"Corner"` with your folder.  
- Change `LIMIT 10` or remove it to see all orphans.  
- To check for notes with no outgoing links, use `length(file.outlinks) = 0`.

---
### 7. Files with External Links
Finds notes that contain links to external websites.  

```dataview
LIST
FROM "Corner"
WHERE any(file.outlinks, (l) => !l.file)
```

**Edit options:**  
- Replace `"Corner"` with your folder.  
- The condition `!l.file` checks for links that are not internal notes. No limit is set; add `LIMIT 20` if needed.

---
### 8. Statistics Summary
Uses DataViewJS to show total notes, tasks, and average word count. 

```dataviewjs
const folder = dv.pages('"Corner"');
dv.paragraph(`**Total notes:** ${folder.length}`);
dv.paragraph(`**Total tasks:** ${folder.file.tasks.length}`);
dv.paragraph(`**Average word count:** ${Math.round(folder.file.lists.length / folder.length)}`);
```

**Edit options:**  
- Replace `"Corner"` with your folder path inside the `dv.pages()` call.  
- Add more stats: e.g., `folder.file.ctime` for earliest creation date.  
- Change the calculation (e.g., average tasks per note).

---
### 9. Calendar Heatmap of Edits
Displays a calendar heatmap of when files were last modified (requires DataViewJS and Heatmap Calendar).  

```dataviewjs
const folder = "/"; // 👈 change to your actual folder
const pages = dv.pages('"' + folder + '"');

// Count notes per date (using last modified date)
const counts = {};
for (let p of pages) {
  let date = p.file.mtime.toISODate();
  counts[date] = (counts[date] || 0) + 1;
}

// Build calendar entries
const calendarData = {
  entries: Object.entries(counts).map(([date, count]) => ({
    date: date,
    intensity: count,        // color intensity based on note count
    content: count.toString() // optional: show count inside cell
  }))
};

renderHeatmapCalendar(this.container, calendarData);
```

**Edit options:**  
- Change `folder = "/"` to a specific folder (e.g., `"Daily Notes"`).  
- Use `p.file.ctime` instead of `mtime` to track creation dates.  
- Adjust `intensity` formula for different coloring (e.g., `intensity: Math.min(count, 10)`).  
- Modify the `content` field to show an icon or leave it blank.

---
### 10. Monthly Calendar 
This script generates a table for the current month, with each day colored based on how many notes were modified that day (or any metric you choose). It's manual, you have to go into the formula and edit the months as they pass. It can help you track productivity for the running month. 

```dataviewjs
// Configuration
const folder = '"/"'; // change to your folder
const year = 2026; // or use new Date().getFullYear()
const month = 2;   // 0 = January, 1 = February, ... 11 = December

// Get pages and count per day
const pages = dv.pages(folder);
const dayCount = {};

pages.forEach(p => {
  let d = p.file.ctime; // or p.file.ctime
  if (d.year === year && d.month === month) {
    let day = d.day;
    dayCount[day] = (dayCount[day] || 0) + 1;
  }
});

// Determine max count for color scaling
const maxCount = Math.max(...Object.values(dayCount), 1);

// Generate month calendar
const daysInMonth = new Date(year, month + 1, 0).getDate();
const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday

let html = '<table style="border-collapse: collapse;">';
html += '<tr><th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th></tr><tr>';

// Empty cells before first day
for (let i = 0; i < firstDay; i++) {
  html += '<td style="width:20px; height:20px;"></td>';
}

for (let d = 1; d <= daysInMonth; d++) {
  let count = dayCount[d] || 0;
  // Intensity from 0 to 255 (green)
  let intensity = Math.min(255, Math.floor(200 * count / maxCount));
  let color = count ? `rgb(${intensity}, 0,0)` : '#262626';
  html += `<td style="background:${color}; text-align:center; border:1px solid #ccc;">${d}</td>`;
  
  if ((firstDay + d) % 7 === 0 && d < daysInMonth) {
    html += '</tr><tr>';
  }
}

html += '</tr></table>';
dv.paragraph(html);
```

**Edit options:**  
- Set `folder` to your target folder (e.g., `'"Journal"'`).  
- Change `year` and `month` to the desired year/month (0-based month).  
- Use `p.file.mtime` instead of `ctime` to track last modified dates.  
- Adjust color: replace `rgb(${intensity}, 0,0)` with `rgb(0, ${intensity}, 0)` for green, etc.  
- Modify cell size (`width:20px; height:20px;`) or border style.

--- 
### 11. Split View: Tasks + Recent Files 

You can create a **split‑view layout** inside a folder note using **DataviewJS** and a little HTML/CSS. This will display a task list on the left and a list of recently modified files on the right – both filtered to a specific folder.  Copy this code into your folder note (replace `"YourFolder"` with your actual folder path):

```dataviewjs
// CONFIGURATION – adjust these to match your vault
const folder = "/";           // target folder (no extra quotes)
const taskLimit = 10;                // max unfinished tasks to show
const recentLimit = 10;             // max recent files to show

// ---------- LEFT COLUMN: UNFINISHED TASKS ----------
let allTasks = [];
for (let page of dv.pages(`"${folder}"`)) {
    if (page.file.tasks) {
        allTasks.push(...page.file.tasks);
    }
}
const incompleteTasks = allTasks.filter(t => !t.completed).slice(0, taskLimit);

// ---------- RIGHT COLUMN: RECENT FILES (with tags underneath) ----------
const recentPages = dv.pages(`"${folder}"`)
    .sort(p => p.file.mtime, 'desc')
    .limit(recentLimit);

// ---------- CREATE TWO‑COLUMN LAYOUT ----------
dv.container.innerHTML = '';                // clear any default output
const flexContainer = dv.container.createDiv();
flexContainer.style.display = 'flex';
flexContainer.style.gap = '2em';

const leftCol = flexContainer.createDiv();
leftCol.style.flex = '1';
leftCol.style.paddingRight = '1em';          // space before the border
leftCol.style.borderRight = '1px solid var(--background-modifier-border)'; // splitter line
leftCol.createEl('h6', { text: '⏳ Unfinished Tasks' });

const rightCol = flexContainer.createDiv();
rightCol.style.flex = '1';
rightCol.style.paddingLeft = '1em';           // space after the border
rightCol.createEl('h6', { text: '📄 Recently Modified' });

// ---------- RENDER LEFT COLUMN (tasks) ----------
const originalContainer = dv.container;      // save global container
dv.container = leftCol;                      // redirect output to leftCol

if (incompleteTasks.length === 0) {
    dv.paragraph('*No unfinished tasks.*');
} else {
    dv.taskList(incompleteTasks);            // interactive checkboxes
}

// ---------- RENDER RIGHT COLUMN (files with tags) ----------
dv.container = rightCol;                     // redirect to rightCol

if (recentPages.length === 0) {
    dv.paragraph('*No files found.*');
} else {
    for (let p of recentPages) {
     const currentEntryDiv = dv.el('div', '', { 
    cls: 'recent-entry',
    attr: { style: 'margin-bottom: 0.8em; border-bottom: 1px dashed var(--background-modifier-border); padding-bottom: 0.8em' } 
    });
    dv.container = currentEntryDiv;
    // ... rest of the code using dv.container
    dv.span(p.file.link);
    if (p.file.tags && p.file.tags.length > 0) {
        dv.el('br', '');
        dv.el('small', p.file.tags.join(', '), { 
        cls: 'recent-tags',
        attr: { style: 'font-size: 0.7em' } });
    }
    dv.container = rightCol;
    
    }
}
// Restore original container
dv.container = originalContainer;
```

---
**Edit Options:**
- **`folder`** – change to your folder name (e.g., `"Projects"`, `"Daily Notes"`).
- **`taskLimit`** / **`fileLimit`** – increase or decrease the number of items shown.
- **Date format** – modify `p.file.mtime.toFormat('yyyy-MM-dd HH:mm')` to your liking (uses Luxon, see [Luxon docs](https://moment.github.io/luxon/#/formatting)).
- **Styling** – adjust the CSS inside the template (colors, padding, borders, etc.).
- **Task display** – you can also show checkboxes by using `<input type="checkbox">` instead of `☐`.

