# User guide

## Inventories and groups

Use **New** in the sidebar to create an inventory or group, or import an inventory archive. Click the application name or logo to return to the inventory overview. Search in the sidebar filters inventory names; the overview has its own search.

Open **Inventory settings** beside an inventory title to rename it, edit its description or configure fields. Drag inventories onto groups to organize them. Groups have one level; deleting a group keeps its inventories. Deleting an inventory removes its fields, items and managed attachments after confirmation.

## Fields

| Type                            | Value                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| Text                            | Text with a fixed limit of 1–1,000 characters; default 255 |
| Number                          | Whole or decimal number                                    |
| Yes/No                          | Yes or no                                                  |
| Checkbox                        | A checkbox editable directly in the table                  |
| Date / Time / Date and time     | A date, time or combined value                             |
| Duration                        | Hours, minutes and seconds                                 |
| Single choice / Multiple choice | One or more options defined for the field                  |
| URL                             | An HTTP(S) link with optional display text                 |
| Files                           | Managed copies of attached files                           |
| Automatic ID                    | A number assigned by the application                       |

Fields can be required and sortable. Drag them to change their order. Field types and text limits are fixed when created; names, selection options and other settings can be edited later. Save the inventory configuration explicitly to apply changes.

Required fields apply to new items and later edits. Adding a required field does not rewrite existing items. Zero and an explicit **No** are valid values.

Automatic IDs start at 1 for each field and inventory. Adding an ID field numbers existing items in creation order. Saved IDs do not change during edits. Deleted numbers are reused only when enabled in the field settings; the smallest free number is used first.

## Items and table views

Use **New item** to add an entry. Edit individual items through their row actions, or use the table's pencil action to edit cells and save or discard the changes together. If toggling a checkbox requires other missing or invalid values to be corrected, the item dialog opens with the checkbox change still unsaved.

Click a sortable column heading to cycle through ascending, descending and original order. Search and field filters narrow the displayed items. Search and filter state is temporary.

Use **View** to show or hide columns, wrap text and enable image previews for file columns. Drag the right edge of a heading to resize it. Right-click a heading to restore automatic width or hide the column. Table preferences are saved separately for each inventory.

If another window changes the same data, the application preserves your draft and reports a conflict. Load the current saved version before trying again. Unsaved changes require confirmation before leaving.

## Attachments

Adding a file creates a managed copy; the original stays unchanged. Click a filename to download that copy. Desktop downloads use a Save As dialog. Optional image previews do not change the original file.

There is no application-imposed file-size limit. **Settings > General** can warn before adding files of 100 MiB or more. Large files and archives still require enough disk space.

## Templates and inventory exchange

In **Inventory settings**, save the structure as a template after saving any pending changes. A template contains fields and selection options, without items or attachments. When creating an inventory, choose a template and the fields to include. Manage templates under **Settings > Templates**. Templates and inventories remain independent after creation.

Export an inventory from its sidebar context menu. The ZIP contains saved fields, items, automatic numbers and attached files. Choose **New > Import inventory**, select the ZIP, review the preview and confirm. Import creates an independent inventory and leaves existing ones unchanged. Groups, templates and table preferences are not part of the exchange archive.

## Backups and restore

Open **Settings > Backups** to create a data backup. Saved backups show their date, kind and size, with actions to download, restore or delete them. Download a copy to another location to protect against loss of the application's disk.

To restore, choose a saved backup or **Restore from file**, review its checked summary and confirm replacement of the current data. A verified safety backup is created first. Reload the application after restoration. Restoration requires a database schema and migration history matching the installed application.

Automatic backups are disabled by default. Choose daily or weekly backups and a retention limit; the default limit is ten automatic archives. Checks run at startup and every minute while the app is running. A missed period results in one backup for the current period, and failures are retried after five minutes. Manual and pre-restore backups are independent of automatic retention.

Data backups include inventories, groups, fields, items, templates, table views and managed attachments. Application settings, storage paths, window state and logs are separate. See [storage and configuration](storage.md) for a complete installation copy.

## Settings

**General** controls language, theme, accent color and large-file warnings. System language selects German for a German locale and English otherwise; system theme follows the operating system.

**Storage locations** moves data and backups to selected folders after confirmation. **Use default** fills in the default path; save the change to apply it. See [storage locations](storage.md#change-storage-locations) before moving an existing installation.

**About** shows the application version, author, project link and MIT license, and offers a manual GitHub release check. It opens release and update links without installing updates.
