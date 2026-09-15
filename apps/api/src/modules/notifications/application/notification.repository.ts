export interface NotificationRecord {
  id: string;
  userId: string;
  sourceEventId: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actionKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationRecord[];
  nextCursor: string | null;
}

export interface NotificationRepository {
  createIfAbsent(
    input: Omit<NotificationRecord, "id" | "readAt" | "createdAt">,
  ): Promise<{
    created: boolean;
    notification: NotificationRecord;
  }>;
  listForUser(input: {
    userId: string;
    cursor?: string | undefined;
    limit: number;
  }): Promise<NotificationPage>;
  countUnread(userId: string): Promise<number>;
  markRead(input: {
    userId: string;
    notificationId: string;
    readAt: Date;
  }): Promise<boolean>;
  markAllRead(input: { userId: string; readAt: Date }): Promise<number>;
}
