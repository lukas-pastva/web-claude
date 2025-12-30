# Web-Claude User Guide

A web interface for browsing and managing your GitHub and GitLab repositories with an integrated Claude AI terminal.

## Getting Started

Open the application in your web browser. You'll see:
- **Left panel**: Repository list and diff viewer
- **Right panel**: Claude AI terminal

## Browsing Repositories

1. Use the **tabs** at the top to switch between GitHub users/organizations and GitLab groups
2. Use the **search bar** to filter repositories by name
3. Click on a repository to clone it (if not already cloned) and open it

## Working with a Repository

Once you select a repository, you can:

### View Changes
- The **diff viewer** shows all uncommitted changes in your repository
- Changes auto-refresh every 5 seconds
- Use the file dropdown to filter changes by specific file
- Toggle between **Pretty** (formatted) and **Raw** diff views
- Click the expand button for fullscreen diff view

### Branch Management

Click the **branch dropdown** (shows current branch name) to:
- View all available branches
- **Switch branches**: Click any branch name to check it out
- **Create new branch**: Click "+ New Branch" at the bottom

#### Creating a New Branch
1. Click the branch dropdown
2. Click **+ New Branch**
3. Enter a name for your new branch
4. Select which branch to create from (defaults to current branch)
5. Click **Create Branch**

The new branch will be created and automatically checked out.

### Git Actions

| Button | Action |
|--------|--------|
| **Branch** | Shows current branch - click to switch or create branches |
| **Pull** | Fetch and merge the latest changes from remote |
| **Push** | Commit all changes and push to remote |
| **Rollback** | Discard all uncommitted changes (requires confirmation) |

The status indicator shows how many commits you are behind the remote branch.

### View Commit History
- Click **Commits** to see recent commit history
- Click the copy icon to copy a commit hash
- Click the link icon to open the commit in GitHub/GitLab

### Browse Files
- Click **Files** to view the repository file tree
- Click on any file to view its contents

## Using the Claude Terminal

The terminal on the right runs the Claude AI assistant in your repository's directory.

### Terminal Controls

| Button | Function |
|--------|----------|
| **A+** / **A-** | Increase or decrease font size |
| **Copy** | Copy selected text from terminal |
| **Paste** | Paste text into terminal |
| **Fullscreen** | Expand terminal to full screen |

### Tips
- The terminal automatically connects when you select a repository
- Type your questions or commands directly to Claude
- Use standard terminal shortcuts (Ctrl+C to cancel, etc.)

## Theme

Click the theme button in the header to switch between:
- **Auto** (follows system preference)
- **Dark** mode
- **Light** mode

Your preference is saved automatically.

## Mobile Usage

The interface is fully responsive and works on mobile devices. On mobile:
- Swipe to navigate between panels
- Haptic feedback alerts you when repository changes are detected
