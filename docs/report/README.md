# Saved report copies

Saving a report writes one JSON file in this folder. The file name is the report id and the version number. A draft stays in the working copy and does not write a file here.

Each file keeps the figures and wording from the moment it was saved. A later change to the live figures leaves that file as it was. A newer save writes a new file.

These copies use the Version 1 statuses Draft and Saved. The JSON files are local working copies and are not committed.

An isolated recovery copies a saved file into a separate directory beside the restored database. It does not write over this folder. A hosted disk or object store has not been verified. That check is separate from the draft and saved state decision.
