export interface NotificationListItem {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actionKey: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationListItem[];
  nextCursor: string | null;
}

export interface NotificationUnreadCount {
  count: number;
}
