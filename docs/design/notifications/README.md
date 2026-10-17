# In-app notifications: synthetic captures

October 17, 2026. Screenshots of the Notifications page, the unread badge and timed popups from step N3 of the [Notification Hub plan](../../architecture/notification-hub-plan.md). They were taken from a local preview on an isolated synthetic database: one manual account, one Play and events inserted as the monitor would write them, delivered by the notifications worker's catch-up. No owner or venue data is involved.

| Capture | Shows |
|---|---|
| [Graphite, desktop](graphite-desktop.png) | Sidebar entry above Settings with the red unread count; Unread and All tabs with server counts; category and severity filters; critical, warning and info popups with their tones |
| [Paper, desktop](paper-desktop.png) | The same in the light theme |
| [Graphite, 390 px](graphite-390.png) | Narrow-screen header bell with the count, the dot on the menu button and a warning popup with its Late tag |
| [Paper, 390 px](paper-390.png) | The same in the light theme with a critical popup |

Popups close by themselves after 20 seconds (critical), 12 (warning) or 6 (info) while the tab is visible and focused; closing on the timer leaves the notification unread on this page.
